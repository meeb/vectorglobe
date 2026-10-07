import { describe, expect, it } from 'vitest';
import { buildGraticule } from '../src/geometry/graticule.ts';
import { LAYER_RADIUS } from '../src/render/renderer.ts';

/** Perpendicular distance from the globe's centre to the chord between two consecutive samples. */
function chordDepth(path: Float32Array, index: number): number {
  const ax = path[index * 3];
  const ay = path[index * 3 + 1];
  const az = path[index * 3 + 2];
  const bx = path[(index + 1) * 3];
  const by = path[(index + 1) * 3 + 1];
  const bz = path[(index + 1) * 3 + 2];
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const mz = (az + bz) / 2;
  return Math.hypot(mx, my, mz);
}

describe('buildGraticule', () => {
  it('keeps every chord close enough to the surface to clear the gap above land', () => {
    // Regression test: a graticule line is a straight 3D chord between samples, not a further-curved
    // one, so it dips below the sphere it traces - a sagitta that grows with the square of the sample
    // spacing. Too coarse a spacing and that dip sinks the chord's middle below LAYER_RADIUS.land,
    // where it depth-tests as hidden behind the land fill - invisible at a zoomed-out view too coarse
    // for the depth buffer to resolve the gap, but breaking the line into dashes once zooming in
    // sharpens that precision enough to catch it. See the comment on SAMPLE_STEP in graticule.ts.
    const gap = LAYER_RADIUS.graticule - LAYER_RADIUS.land;
    const paths = buildGraticule(LAYER_RADIUS.graticule, 15);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const points = path.length / 3;
      for (let i = 0; i < points - 1; i++) {
        const depth = LAYER_RADIUS.graticule - chordDepth(path, i);
        expect(depth).toBeLessThan(gap);
      }
    }
  });

  it('still starts and ends each line exactly on the grid, regardless of sample density', () => {
    const paths = buildGraticule(1, 15);
    for (const path of paths) {
      const start = Math.hypot(path[0], path[1], path[2]);
      const last = path.length / 3 - 1;
      const end = Math.hypot(path[last * 3], path[last * 3 + 1], path[last * 3 + 2]);
      expect(start).toBeCloseTo(1, 5);
      expect(end).toBeCloseTo(1, 5);
    }
  });
});
