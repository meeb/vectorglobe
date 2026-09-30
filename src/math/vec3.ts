/** A 3 component vector, always a plain array so it stays cheap to allocate and easy to inline. */
export type Vec3 = [number, number, number];

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
}

/** Spherical interpolation between two unit vectors, the basis of every great circle in the map. */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const cosAngle = Math.min(1, Math.max(-1, dot(a, b)));
  const angle = Math.acos(cosAngle);
  if (angle < 1e-6) {
    return [a[0], a[1], a[2]];
  }
  const sinAngle = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sinAngle;
  const wb = Math.sin(t * angle) / sinAngle;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
}

/** Rotate a vector around an arbitrary unit axis, using Rodrigues' rotation formula. */
export function rotateAroundAxis(v: Vec3, axis: Vec3, radians: number): Vec3 {
  const k = normalize(axis);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const kCrossV = cross(k, v);
  const kDotV = dot(k, v);
  return [
    v[0] * cos + kCrossV[0] * sin + k[0] * kDotV * (1 - cos),
    v[1] * cos + kCrossV[1] * sin + k[1] * kDotV * (1 - cos),
    v[2] * cos + kCrossV[2] * sin + k[2] * kDotV * (1 - cos),
  ];
}
