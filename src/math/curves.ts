/**
 * Route curve generation.
 *
 * Both kinds of connection end up as the same thing: a flat array of globe space positions that the
 * renderers turn into a line. A generated route is a great circle between two points, lifted into an
 * arc; an explicit route is a spline fitted through every coordinate the caller supplied.
 */

import { angularDistance } from './geo.ts';
import { length, normalize, slerp, type Vec3 } from './vec3.ts';

/**
 * Sample a great circle between two positions, lifted into an arc.
 *
 * The apex height scales with how far apart the ends are, so a short hop stays close to the surface
 * while a long haul bows out properly. This is what makes a map of flight routes readable.
 */
export function greatCircleArc(
  from: Vec3,
  to: Vec3,
  segments: number,
  arcHeight: number,
): Float32Array {
  const steps = Math.max(2, Math.floor(segments));
  const out = new Float32Array((steps + 1) * 3);
  const separation = angularDistance(from, to) / Math.PI;
  const apex = arcHeight * Math.max(0.15, separation);
  const startRadius = length(from);
  const endRadius = length(to);
  const a = normalize(from);
  const b = normalize(to);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const direction = slerp(a, b, t);
    // sin() gives zero lift at both ends and the full apex in the middle.
    const radius = startRadius + (endRadius - startRadius) * t + apex * Math.sin(t * Math.PI);
    out[i * 3] = direction[0] * radius;
    out[i * 3 + 1] = direction[1] * radius;
    out[i * 3 + 2] = direction[2] * radius;
  }

  return out;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Fit a smooth curve through every supplied position.
 *
 * A Catmull-Rom spline is used because it passes through the control points rather than being pulled
 * away from them, which is what a caller means when they hand over a recorded flight path. Direction
 * and radius are interpolated separately so the curve hugs the globe instead of cutting through it.
 */
export function smoothPath(positions: Vec3[], segmentsPerSpan: number): Float32Array {
  if (positions.length < 2) {
    return Float32Array.from(positions.flat());
  }

  const steps = Math.max(1, Math.floor(segmentsPerSpan));
  const directions = positions.map(normalize);
  const radii = positions.map(length);
  const spans = positions.length - 1;
  const out = new Float32Array((spans * steps + 1) * 3);
  let index = 0;

  const at = (i: number): number => Math.min(positions.length - 1, Math.max(0, i));

  for (let span = 0; span < spans; span++) {
    const i0 = at(span - 1);
    const i1 = span;
    const i2 = at(span + 1);
    const i3 = at(span + 2);

    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const direction = normalize([
        catmullRom(directions[i0][0], directions[i1][0], directions[i2][0], directions[i3][0], t),
        catmullRom(directions[i0][1], directions[i1][1], directions[i2][1], directions[i3][1], t),
        catmullRom(directions[i0][2], directions[i1][2], directions[i2][2], directions[i3][2], t),
      ]);
      const radius = catmullRom(radii[i0], radii[i1], radii[i2], radii[i3], t);
      out[index++] = direction[0] * radius;
      out[index++] = direction[1] * radius;
      out[index++] = direction[2] * radius;
    }
  }

  const last = positions[positions.length - 1];
  out[index++] = last[0];
  out[index++] = last[1];
  out[index++] = last[2];
  return out;
}

/** Join positions with straight segments, subdivided along the sphere so they follow its curve. */
export function linearPath(positions: Vec3[], segmentsPerSpan: number): Float32Array {
  if (positions.length < 2) {
    return Float32Array.from(positions.flat());
  }

  const steps = Math.max(1, Math.floor(segmentsPerSpan));
  const spans = positions.length - 1;
  const out = new Float32Array((spans * steps + 1) * 3);
  let index = 0;

  for (let span = 0; span < spans; span++) {
    const from = positions[span];
    const to = positions[span + 1];
    const a = normalize(from);
    const b = normalize(to);
    const radiusA = length(from);
    const radiusB = length(to);

    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const direction = slerp(a, b, t);
      const radius = radiusA + (radiusB - radiusA) * t;
      out[index++] = direction[0] * radius;
      out[index++] = direction[1] * radius;
      out[index++] = direction[2] * radius;
    }
  }

  const last = positions[positions.length - 1];
  out[index++] = last[0];
  out[index++] = last[1];
  out[index++] = last[2];
  return out;
}
