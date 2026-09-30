/**
 * Sync the embedded world border data.
 *
 *   node scripts/sync-world.ts [--simplify 20] [--check] [--force]
 *
 * Downloads a pinned release of the Natural Earth 1:50m country borders, simplifies it with
 * mapshaper, builds a shared-arc topology and re-encodes the result into `src/data/world.generated.ts`.
 *
 * Keeping the topology matters: a border between two countries exists as a single arc, so it is
 * stored once and drawn once.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';
import { encodeArcs, encodeShapes, type Polygon } from '../src/data/codec.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache');
const OUTPUT_FILE = join(ROOT, 'src', 'data', 'world.generated.ts');

/** Pinned so a sync is reproducible; bump deliberately when Natural Earth publishes a new release. */
const SOURCE_TAG = 'v5.1.2';
const SOURCE_FILE = 'ne_50m_admin_0_countries.geojson';
const SOURCE_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${SOURCE_TAG}/geojson/${SOURCE_FILE}`;

interface Args {
  simplify: number;
  check: boolean;
  force: boolean;
}

interface CountryRecord {
  name: string;
  iso2: string;
  iso3: string;
  continent: string;
}

interface TopoGeometry {
  type: string;
  arcs?: number[][] | number[][][];
  properties?: Record<string, unknown>;
}

interface Topology {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, { geometries: TopoGeometry[] }>;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { simplify: 20, check: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--simplify') {
      args.simplify = Number(argv[++i]);
    } else if (argv[i] === '--check') {
      args.check = true;
    } else if (argv[i] === '--force') {
      args.force = true;
    }
  }
  if (!Number.isFinite(args.simplify) || args.simplify <= 0 || args.simplify > 100) {
    throw new Error(`invalid --simplify value, expected 1-100, got ${args.simplify}`);
  }
  return args;
}

async function fetchSource(force: boolean): Promise<Buffer> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cached = join(CACHE_DIR, `${SOURCE_TAG}-${SOURCE_FILE}`);
  if (!force && existsSync(cached)) {
    console.log(`  using cached download ${cached}`);
    return readFile(cached);
  }
  console.log(`  downloading ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(cached, buffer);
  return buffer;
}

/** Natural Earth uses "-99" where a country has no ISO code assigned; the _EH fields fill some gaps. */
function isoCode(properties: Record<string, unknown>, primary: string, fallback: string): string {
  const first = String(properties[primary] ?? '');
  if (first && first !== '-99') {
    return first;
  }
  const second = String(properties[fallback] ?? '');
  return second && second !== '-99' ? second : '';
}

async function simplify(source: Buffer, percentage: number): Promise<Topology> {
  const command = [
    '-i input.geojson',
    // Antarctica's source ring closes itself by marching through dozens of points at
    // lat=-89.998926 across almost every longitude - a deliberate "polar cap" closure in Natural
    // Earth's own data, not a defect. Projected onto a sphere those points collapse onto (or right
    // next to) the pole itself, so the last real coastal point before the cap and the first real
    // coastal point after it end up joined by what looks like two spikes through the globe's centre.
    // (A `-clip` step just short of the pole was tried here and rejected: clipping a polygon against
    // a bounding box makes mapshaper trace the box's own edge to re-close the shape, which walks up
    // the antimeridian at constant longitude across the *same* latitude range as real coastline -
    // trading one artefact for a harder-to-filter one. The cap points are left in the data and
    // filtered out by latitude instead, at render time in `buildBorderPaths()` - see
    // POLE_EXCLUSION_LAT in landmesh.ts - where they are reliably identifiable because they sit
    // within a fraction of a degree of the pole, unlike any real coastline point.)
    '-filter-fields NAME,ISO_A2,ISO_A3,ISO_A2_EH,ISO_A3_EH,CONTINENT',
    `-simplify visvalingam percentage=${percentage}% keep-shapes`,
    '-clean',
    '-o format=topojson out.json',
  ].join(' ');
  const output = await mapshaper.applyCommands(command, { 'input.geojson': source });
  return JSON.parse(Buffer.from(output['out.json']).toString('utf8')) as Topology;
}

/** Undo the TopoJSON delta encoding and quantisation transform, yielding absolute lon/lat arcs. */
function absoluteArcs(topology: Topology): number[][][] {
  const transform = topology.transform;
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map((point) => {
      if (!transform) {
        return [point[0], point[1]];
      }
      x += point[0];
      y += point[1];
      return [
        x * transform.scale[0] + transform.translate[0],
        y * transform.scale[1] + transform.translate[1],
      ];
    });
  });
}

function collectShapes(topology: Topology): { countries: CountryRecord[]; shapes: Polygon[][] } {
  const objectKey = Object.keys(topology.objects)[0];
  const geometries = topology.objects[objectKey].geometries;
  const countries: CountryRecord[] = [];
  const shapes: Polygon[][] = [];

  for (const geometry of geometries) {
    if (!geometry.arcs || geometry.arcs.length === 0) {
      continue;
    }
    const properties = geometry.properties ?? {};
    countries.push({
      name: String(properties.NAME ?? 'Unknown'),
      iso2: isoCode(properties, 'ISO_A2', 'ISO_A2_EH'),
      iso3: isoCode(properties, 'ISO_A3', 'ISO_A3_EH'),
      continent: String(properties.CONTINENT ?? ''),
    });
    const polygons =
      geometry.type === 'Polygon' ? [geometry.arcs as number[][]] : (geometry.arcs as number[][][]);
    shapes.push(polygons.map((rings) => rings.map((ring) => ring.slice())));
  }

  return { countries, shapes };
}

function renderModule(params: {
  countries: CountryRecord[];
  arcsPayload: string;
  shapesPayload: string;
  meta: Record<string, string | number>;
}): string {
  // JSON.stringify handles the escaping; country names contain apostrophes and accented characters.
  const countryTable = JSON.stringify(
    params.countries.map((c) => `${c.name}|${c.iso2}|${c.iso3}|${c.continent}`).join('\n'),
  );

  return `/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Regenerate with \`make sync\`. See scripts/sync-world.ts for the pipeline.
 *
 * Source:     ${params.meta.source}
 * Release:    ${params.meta.tag}
 * Checksum:   sha256:${params.meta.sha256}
 * Simplified: ${params.meta.simplify}% of original vertices retained
 * Synced:     ${params.meta.synced}
 * Geometry:   ${params.meta.arcs} arcs, ${params.meta.points} points, ${params.meta.countries} countries
 * Payload:    ${params.meta.arcBytes} bytes of arcs, ${params.meta.shapeBytes} bytes of shapes (base64)
 */

/** Provenance of the embedded data, exposed so applications can attribute the source. */
export const WORLD_META = {
  source: ${JSON.stringify(params.meta.source)},
  tag: ${JSON.stringify(params.meta.tag)},
  checksum: ${JSON.stringify(params.meta.sha256)},
  simplify: ${params.meta.simplify},
  synced: ${JSON.stringify(params.meta.synced)},
  arcs: ${params.meta.arcs},
  points: ${params.meta.points},
  countries: ${params.meta.countries},
} as const;

/**
 * One newline separated record per country: name|iso2|iso3|continent, ordered to match WORLD_SHAPES.
 *
 * The payload constants are annotated as \`string\` rather than left to inference, which would bake the
 * entire literal into the emitted declarations and add tens of kilobytes to the published types.
 */
export const WORLD_COUNTRIES: string = ${countryTable};

/** Quantised, delta encoded arc geometry. Decode with decodeArcs(). */
export const WORLD_ARCS: string =
  ${JSON.stringify(params.arcsPayload)};

/** Country to polygon to ring arc references. Decode with decodeShapes(). */
export const WORLD_SHAPES: string =
  ${JSON.stringify(params.shapesPayload)};
`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`vectorglobe: syncing world data (simplify=${args.simplify}%)`);

  const source = await fetchSource(args.force);
  const sha256 = createHash('sha256').update(source).digest('hex');
  console.log(`  source ${(source.length / 1024).toFixed(0)}KB sha256:${sha256.slice(0, 16)}...`);

  const topology = await simplify(source, args.simplify);
  const arcs = absoluteArcs(topology);
  const { countries, shapes } = collectShapes(topology);
  const points = arcs.reduce((total, arc) => total + arc.length, 0);

  const arcsPayload = encodeArcs(arcs);
  const shapesPayload = encodeShapes(shapes);

  const module = renderModule({
    countries,
    arcsPayload,
    shapesPayload,
    meta: {
      source: SOURCE_URL,
      tag: SOURCE_TAG,
      sha256,
      simplify: args.simplify,
      synced: new Date().toISOString().slice(0, 10),
      arcs: arcs.length,
      points,
      countries: countries.length,
      arcBytes: arcsPayload.length,
      shapeBytes: shapesPayload.length,
    },
  });

  console.log(`  geometry ${arcs.length} arcs, ${points} points, ${countries.length} countries`);
  console.log(
    `  encoded  arcs ${(arcsPayload.length / 1024).toFixed(1)}KB, shapes ${(shapesPayload.length / 1024).toFixed(1)}KB, module ${(module.length / 1024).toFixed(1)}KB`,
  );

  if (args.check) {
    const existing = existsSync(OUTPUT_FILE) ? await readFile(OUTPUT_FILE, 'utf8') : '';
    // The sync date changes on every run, so compare everything except that line.
    const strip = (text: string) =>
      text.replace(/^ \* Synced:.*$/m, '').replace(/^ {2}synced: .*$/m, '');
    if (strip(existing) !== strip(module)) {
      console.error('  FAIL: src/data/world.generated.ts is out of date, run `make sync`');
      process.exitCode = 1;
      return;
    }
    console.log('  OK: committed world data matches the pipeline output');
    return;
  }

  await writeFile(OUTPUT_FILE, module);
  console.log(`  wrote ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
