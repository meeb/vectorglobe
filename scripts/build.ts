/**
 * Build the distributable bundles.
 *
 *   node scripts/build.ts [--size-only] [--watch]
 *
 * Produces a single file for a script tag, ESM and CJS builds for bundlers, and type declarations.
 * The world data is compiled in, so nothing the map needs is fetched at runtime.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ENTRY = join(ROOT, 'src', 'index.ts');

/**
 * The single file build must stay under these sizes, checked on every build and in CI.
 *
 * Raised from 110KB/45KB when the embedded world data moved from Natural Earth 1:110m to 1:50m
 * (see scripts/sync-world.ts) - the actual build sits at roughly 143KB/80KB, so there is headroom
 * for the JS itself to grow without the data bump alone tripping this.
 */
const BUDGET = { minified: 155 * 1024, gzipped: 90 * 1024 };

/**
 * Browsers the output is compiled for.
 *
 * Safari 15 rather than 14 is the floor: esbuild refuses to target Safari 14 for code using ordinary
 * destructuring, because of a destructuring bug in that release it cannot work around.
 */
const TARGET = ['es2020', 'chrome80', 'firefox78', 'safari15', 'edge88'];

interface Output {
  label: string;
  file: string;
}

/** Everything the build produces, in the order the size report lists them. */
const OUTPUTS: Output[] = [
  { label: 'iife (minified)', file: 'vectorglobe.min.js' },
  { label: 'iife', file: 'vectorglobe.js' },
  { label: 'esm', file: 'vectorglobe.esm.js' },
  { label: 'cjs', file: 'vectorglobe.cjs' },
];

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  return manifest.version as string;
}

function banner(version: string): string {
  return `/*! vectorglobe ${version} | MIT | https://github.com/meeb/vectorglobe */`;
}

async function build(version: string): Promise<void> {
  const shared: esbuild.BuildOptions = {
    entryPoints: [ENTRY],
    bundle: true,
    target: TARGET,
    define: { __VECTORGLOBE_VERSION__: JSON.stringify(version) },
    banner: { js: banner(version) },
    legalComments: 'none',
    logLevel: 'warning',
  };

  await Promise.all([
    // The headline artefact: drop it in a script tag and call the global.
    esbuild.build({
      ...shared,
      outfile: join(DIST, 'vectorglobe.min.js'),
      format: 'iife',
      globalName: 'VectorGlobe',
      footer: { js: 'VectorGlobe=Object.assign(VectorGlobe.vectorGlobe,VectorGlobe);' },
      minify: true,
    }),
    esbuild.build({
      ...shared,
      outfile: join(DIST, 'vectorglobe.js'),
      format: 'iife',
      globalName: 'VectorGlobe',
      footer: { js: 'VectorGlobe = Object.assign(VectorGlobe.vectorGlobe, VectorGlobe);' },
      minify: false,
    }),
    esbuild.build({
      ...shared,
      outfile: join(DIST, 'vectorglobe.esm.js'),
      format: 'esm',
      minify: true,
    }),
    esbuild.build({
      ...shared,
      outfile: join(DIST, 'vectorglobe.cjs'),
      format: 'cjs',
      minify: true,
    }),
  ]);
}

async function buildTypes(): Promise<void> {
  await run(
    'node',
    [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'],
    {
      cwd: ROOT,
    },
  );
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1).padStart(6)} KB`;
}

async function report(): Promise<boolean> {
  console.log('\n  artefact                       raw      gzip    brotli');
  console.log('  ------------------------------------------------------');

  let withinBudget = true;
  for (const output of OUTPUTS) {
    const path = join(DIST, output.file);
    if (!existsSync(path)) {
      continue;
    }
    const contents = await readFile(path);
    const gzip = gzipSync(contents, { level: 9 }).length;
    const brotli = brotliCompressSync(contents).length;
    console.log(
      `  ${output.file.padEnd(22)} ${formatSize(contents.length)} ${formatSize(gzip)} ${formatSize(brotli)}`,
    );

    if (output.file === 'vectorglobe.min.js') {
      if (contents.length > BUDGET.minified || gzip > BUDGET.gzipped) {
        withinBudget = false;
        console.log(
          `\n  FAIL: budget is ${formatSize(BUDGET.minified)} raw and ${formatSize(BUDGET.gzipped)} gzipped`,
        );
      }
      // Nothing in the bundle should reach out to the network at runtime.
      const text = contents.toString('utf8');
      const remoteReferences = text.match(
        /https?:\/\/(?!github\.com\/meeb|raw\.githubusercontent)/g,
      );
      if (remoteReferences) {
        console.log(
          `\n  WARNING: bundle contains ${remoteReferences.length} external URL reference(s)`,
        );
      }
    }
  }

  return withinBudget;
}

async function main(): Promise<void> {
  const sizeOnly = process.argv.includes('--size-only');
  const version = await packageVersion();

  if (!sizeOnly) {
    console.log(`vectorglobe: building ${version}`);
    await rm(DIST, { recursive: true, force: true });
    await mkdir(DIST, { recursive: true });
    await build(version);
    await buildTypes();
    console.log('  bundles and declarations written to dist/');
  }

  const withinBudget = await report();
  if (!withinBudget) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
