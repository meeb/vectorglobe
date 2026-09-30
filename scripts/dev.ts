/**
 * Development server.
 *
 *   node scripts/dev.ts [--port 8080]
 *
 * Rebuilds the bundle on every change and serves the examples directory, so the demo page always
 * runs the current source.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = join(ROOT, 'examples');

function parsePort(argv: string[]): number {
  const index = argv.indexOf('--port');
  const value = index >= 0 ? Number(argv[index + 1]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : 8080;
}

async function main(): Promise<void> {
  const port = parsePort(process.argv.slice(2));

  const context = await esbuild.context({
    entryPoints: [join(ROOT, 'src', 'index.ts')],
    // Built straight into the examples directory so the demo can load it with a plain script tag,
    // exactly the way a website would use the published file.
    outfile: join(EXAMPLES, 'vectorglobe.js'),
    bundle: true,
    format: 'iife',
    globalName: 'VectorGlobe',
    footer: { js: 'VectorGlobe = Object.assign(VectorGlobe.vectorGlobe, VectorGlobe);' },
    define: { __VECTORGLOBE_VERSION__: '"dev"' },
    sourcemap: 'inline',
    target: ['es2020'],
    logLevel: 'info',
  });

  await context.watch();
  const server = await context.serve({ servedir: EXAMPLES, port, host: '127.0.0.1' });

  console.log(`\n  vectorglobe demo on http://${server.hosts[0] ?? '127.0.0.1'}:${server.port}/\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
