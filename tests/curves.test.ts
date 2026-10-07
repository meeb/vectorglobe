import { describe, expect, it } from 'vitest';
import { greatCircleArc, linearPath, smoothPath } from '../src/math/curves.ts';
import { angularDistance, lonLatToVec3, vec3ToLonLat } from '../src/math/geo.ts';
import { normalize, type Vec3 } from '../src/math/vec3.ts';

const radiusAt = (positions: Float32Array, index: number): number =>
  Math.hypot(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);

/** Largest angle, in degrees, between any two consecutive sampled points. */
function largestStepDegrees(positions: Float32Array): number {
  let largest = 0;
  for (let i = 0; i < positions.length / 3 - 1; i++) {
    const a: Vec3 = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const b: Vec3 = [
      positions[(i + 1) * 3],
      positions[(i + 1) * 3 + 1],
      positions[(i + 1) * 3 + 2],
    ];
    largest = Math.max(largest, (angularDistance(normalize(a), normalize(b)) * 180) / Math.PI);
  }
  return largest;
}

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

  it('subdivides a long arc enough regardless of how few segments were asked for', () => {
    // Regression test: a long screen-space line built from one wide-angle segment rasterizes as
    // nothing at all on some GPUs. A near-antipodal arc sampled this coarsely used to produce a
    // single ~175 degree segment; it must now be broken up no matter how low `segments` is.
    const arc = greatCircleArc(lonLatToVec3(0, 0), lonLatToVec3(175, 0), 2, 0.3);
    expect(largestStepDegrees(arc)).toBeLessThanOrEqual(3);
  });

  describe('autoHeight', () => {
    // LHR to MAN is about 2.3 degrees apart - well under the 27 degree (0.15 separation) floor that
    // otherwise keeps a short hop's apex as tall as a ~3000km route's, the bug this exists to fix.
    const lhr = lonLatToVec3(-0.4543, 51.47);
    const man = lonLatToVec3(-2.2744, 53.3537);

    it('is off by default, the same apex a route always had', () => {
      const withoutFlag = greatCircleArc(lhr, man, 16, 0.3);
      const explicitlyOff = greatCircleArc(lhr, man, 16, 0.3, false);
      const peak = Math.floor(withoutFlag.length / 3 / 2);
      expect(radiusAt(withoutFlag, peak)).toBeCloseTo(radiusAt(explicitlyOff, peak), 10);
    });

    it('lowers the apex of a short hop below the floored default', () => {
      const floored = greatCircleArc(lhr, man, 16, 0.3, false);
      const scaled = greatCircleArc(lhr, man, 16, 0.3, true);
      const peak = Math.floor(floored.length / 3 / 2);
      expect(radiusAt(scaled, peak)).toBeLessThan(radiusAt(floored, peak));
    });

    it('never raises a short hop above the length it would otherwise bow to', () => {
      // The height above the surface, not the full radius: an apex taller than the route is long is
      // exactly the spike this is meant to prevent.
      const scaled = greatCircleArc(lhr, man, 16, 0.3, true);
      const peak = Math.floor(scaled.length / 3 / 2);
      const separationKm = angularDistance(lhr, man) * 6371;
      const apexKm = (radiusAt(scaled, peak) - 1) * 6371;
      expect(apexKm).toBeLessThan(separationKm);
    });

    it('leaves a route far enough apart unaffected', () => {
      const lax = lonLatToVec3(-118.4085, 33.9416);
      const withFlag = greatCircleArc(lhr, lax, 16, 0.3, true);
      const withoutFlag = greatCircleArc(lhr, lax, 16, 0.3, false);
      const peak = Math.floor(withFlag.length / 3 / 2);
      expect(radiusAt(withFlag, peak)).toBeCloseTo(radiusAt(withoutFlag, peak), 5);
    });
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

  it('subdivides a wide jump between two points enough, however low segmentsPerSpan is', () => {
    // Regression test: real tracking data can jump a long way in one recorded point - a flight's
    // transponder losing signal over an ocean and picking back up far away, say. Sampled at just
    // one step per span, that jump used to become a single wide-angle segment that silently failed
    // to render on some GPUs. Both path builders must now break it into shorter steps regardless.
    const jumpy: Vec3[] = [
      lonLatToVec3(-150, 60),
      lonLatToVec3(-150, 60),
      lonLatToVec3(140, 38),
      lonLatToVec3(139, 37),
    ];
    for (const build of [linearPath, smoothPath]) {
      // Not a tight bound on the 3 degree target itself: a Catmull-Rom span isn't sampled at a
      // uniform angular rate, so a step can slightly overshoot it. What matters for the bug this
      // guards against is staying far below the ~11-17 degrees a step needed to start silently
      // failing to render, and this is comfortably under that.
      expect(largestStepDegrees(build(jumpy, 1))).toBeLessThan(6);
    }
  });
});
