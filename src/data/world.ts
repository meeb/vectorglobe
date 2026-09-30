/**
 * Access to the embedded world geometry.
 *
 * Decoding is done once, lazily, the first time a map is created. Everything derived from the raw
 * payload lives here so the renderers can share one copy of the geometry.
 */

import { type ArcSet, decodeArcs, decodeShapes, type Polygon, resolveArcRef } from './codec.ts';
import { WORLD_ARCS, WORLD_COUNTRIES, WORLD_META, WORLD_SHAPES } from './world.generated.ts';

export interface CountryInfo {
  name: string;
  /** ISO 3166-1 alpha-2, empty for territories without an assigned code. */
  iso2: string;
  /** ISO 3166-1 alpha-3, empty for territories without an assigned code. */
  iso3: string;
  continent: string;
}

export interface World {
  /** Every border segment, stored once and shared between the countries either side of it. */
  arcs: ArcSet;
  /** Country to polygon to ring to arc references. */
  shapes: Polygon[][];
  countries: CountryInfo[];
  /** How many countries reference each arc; 1 means a coastline, more means an internal border. */
  arcUse: Uint8Array;
  meta: typeof WORLD_META;
}

let cached: World | null = null;

/** Decode the embedded world data, reusing the result across every map on the page. */
export function getWorld(): World {
  if (cached) {
    return cached;
  }

  const arcs = decodeArcs(WORLD_ARCS);
  const shapes = decodeShapes(WORLD_SHAPES);
  const countries = WORLD_COUNTRIES.split('\n').map((record) => {
    const [name, iso2, iso3, continent] = record.split('|');
    return { name, iso2, iso3, continent };
  });

  const arcUse = new Uint8Array(arcs.offsets.length - 1);
  for (const polygons of shapes) {
    for (const rings of polygons) {
      for (const ring of rings) {
        for (const ref of ring) {
          const { index } = resolveArcRef(ref);
          if (arcUse[index] < 255) {
            arcUse[index]++;
          }
        }
      }
    }
  }

  cached = { arcs, shapes, countries, arcUse, meta: WORLD_META };
  return cached;
}

/** Copy one arc out as lon/lat pairs, reversing it when the reference says so. */
export function arcCoordinates(arcs: ArcSet, ref: number): Float32Array {
  const { index, reversed } = resolveArcRef(ref);
  const start = arcs.offsets[index];
  const end = arcs.offsets[index + 1];
  const count = end - start;
  const out = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const source = reversed ? end - 1 - i : start + i;
    out[i * 2] = arcs.coords[source * 2];
    out[i * 2 + 1] = arcs.coords[source * 2 + 1];
  }
  return out;
}

/**
 * Build a closed lon/lat ring by walking its arc references.
 *
 * Consecutive arcs share an endpoint, so the duplicate is dropped as each arc is appended.
 */
export function ringCoordinates(arcs: ArcSet, ring: number[]): Float32Array {
  const parts: Float32Array[] = [];
  let total = 0;

  for (let i = 0; i < ring.length; i++) {
    const part = arcCoordinates(arcs, ring[i]);
    const skip = i > 0 ? 2 : 0;
    const sliced = skip ? part.subarray(skip) : part;
    parts.push(sliced);
    total += sliced.length;
  }

  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
