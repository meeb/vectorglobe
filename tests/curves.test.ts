import { describe, expect, it } from 'vitest';
import { greatCircleArc, linearPath, smoothPath } from '../src/math/curves.ts';
import { lonLatToVec3, vec3ToLonLat } from '../src/math/geo.ts';
import type { Vec3 } from '../src/math/vec3.ts';

const radiusAt = (positions: Float32Array, index: number): number =>
  Math.hypot(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);

describe('generated arcs', () => {
  const from = lonLatToVec3(-0.45, 51.47);
  const to = lonLatToVec3(-73.78, 40.64);

  it('starts and ends exactly at the two points', () => {
    const arc = greatCircleArc(from, to, 32, 0.3);
    expect(arc[0]).toBeCloseTo(from[0], 5);
    expect(arc[1]).toBeCloseTo(from[1], 5);
    expect(arc[2]).toBeCloseTo(from[2], 5);
    const last = arc.length / 3 - 1;
    expect(arc[last * 3]).toBeCloseTo(to[0], 5);
    expect(arc[last * 3 + 2]).toBeCloseTo(to[2], 5);
  });

  it('bows away from the surface in the middle and returns to it at the ends', () => {
    const arc = greatCircleArc(from, to, 32, 0.3);
    const count = arc.length / 3;
    expect(radiusAt(arc, 0)).toBeCloseTo(1, 5);
    expect(radiusAt(arc, count - 1)).toBeCloseTo(1, 5);
    expect(radiusAt(arc, Math.floor(count / 2))).toBeGreaterThan(1.02);
  });

  it('lifts a long route higher than a short one', () => {
    const shortHop = greatCircleArc(lonLatToVec3(0, 0), lonLatToVec3(5, 0), 16, 0.3);
    const longHaul = greatCircleArc(lonLatToVec3(0, 0), lonLatToVec3(170, 0), 16, 0.3);
    expect(radiusAt(longHaul, 8)).toBeGreaterThan(radiusAt(shortHop, 8));
  });

  it('follows the great circle rather than a straight line through the globe', () => {
    // A route between two points on the equator should stay on the equator.
    const arc = greatCircleArc(lonLatToVec3(-60, 0), lonLatToVec3(60, 0), 16, 0);
    for (let i = 0; i < arc.length / 3; i++) {
      const [, lat] = vec3ToLonLat([arc[i * 3], arc[i * 3 + 1], arc[i * 3 + 2]]);
      expect(Math.abs(lat)).toBeLessThan(1e-4);
    }
  });

  it('never returns fewer than two points', () => {
    expect(greatCircleArc(from, to, 0, 0.2).length / 3).toBeGreaterThanOrEqual(3);
  });
});

describe('explicit paths', () => {
  const control: Vec3[] = [
    lonLatToVec3(0, 0, 1),
    lonLatToVec3(10, 10, 1.01),
    lonLatToVec3(20, 5, 1.02),
    lonLatToVec3(30, 15, 1),
  ];

  it('passes through every coordinate it was given', () => {
    const smooth = smoothPath(control, 8);
    const count = smooth.length / 3;
    for (const point of control) {
      let closest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < count; i++) {
        closest = Math.min(
          closest,
          Math.hypot(
            smooth[i * 3] - point[0],
            smooth[i * 3 + 1] - point[1],
            smooth[i * 3 + 2] - point[2],
          ),
        );
      }
      expect(closest).toBeLessThan(1e-5);
    }
  });

  it('keeps the curve on or above the surface', () => {
    const smooth = smoothPath(control, 12);
    for (let i = 0; i < smooth.length / 3; i++) {
      expect(radiusAt(smooth, i)).toBeGreaterThan(0.999);
    }
  });

  it('ends exactly on the last coordinate', () => {
    for (const build of [smoothPath, linearPath]) {
      const path = build(control, 6);
      const last = path.length / 3 - 1;
      expect(path[last * 3]).toBeCloseTo(control[3][0], 6);
      expect(path[last * 3 + 1]).toBeCloseTo(control[3][1], 6);
      expect(path[last * 3 + 2]).toBeCloseTo(control[3][2], 6);
    }
  });

  it('subdivides each span the requested number of times', () => {
    expect(linearPath(control, 5).length / 3).toBe(3 * 5 + 1);
  });

  it('returns the input unchanged when there is nothing to interpolate', () => {
    expect(smoothPath([control[0]], 8).length / 3).toBe(1);
  });
});
