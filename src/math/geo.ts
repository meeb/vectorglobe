/**
 * Geographic conversions.
 *
 * The map works in a unit sphere space where the globe has radius 1, longitude 0 / latitude 0 faces
 * +Z and +Y is north. Altitudes are expressed in globe radii, so ground level is exactly 1.
 */

import { dot, normalize, type Vec3 } from './vec3.ts';

/** Mean Earth radius, used to convert route altitudes given in kilometres. */
export const EARTH_RADIUS_KM = 6371;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Convert a geographic position to a position in globe space. */
export function lonLatToVec3(lon: number, lat: number, radius = 1): Vec3 {
  const phi = lat * DEG_TO_RAD;
  const theta = lon * DEG_TO_RAD;
  const cosPhi = Math.cos(phi);
  return [
    radius * cosPhi * Math.sin(theta),
    radius * Math.sin(phi),
    radius * cosPhi * Math.cos(theta),
  ];
}

/** Convert a position in globe space back to longitude and latitude in degrees. */
export function vec3ToLonLat(v: Vec3): [number, number] {
  const unit = normalize(v);
  return [
    Math.atan2(unit[0], unit[2]) * RAD_TO_DEG,
    Math.asin(Math.min(1, Math.max(-1, unit[1]))) * RAD_TO_DEG,
  ];
}

/**
 * Wrap a longitude into the -180 to 180 range.
 *
 * The range is half open: exactly 180 comes back as -180, so the date line has a single
 * representation rather than two.
 */
export function normalizeLon(lon: number): number {
  const wrapped = (((lon + 180) % 360) + 360) % 360;
  return wrapped - 180;
}

/** Clamp a latitude to the poles. */
export function clampLat(lat: number): number {
  return lat < -90 ? -90 : lat > 90 ? 90 : lat;
}

/** Angle between two positions on the globe, in radians. */
export function angularDistance(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(normalize(a), normalize(b)))));
}

/** Convert an altitude in kilometres above sea level into globe radii from the centre. */
export function kmToRadius(km: number): number {
  return 1 + km / EARTH_RADIUS_KM;
}

/**
 * Split a lon/lat polyline wherever it crosses the date line.
 *
 * In 2D a route from Tokyo to Los Angeles would otherwise draw a horizontal streak straight back
 * across the map, so each crossing becomes a clean break with both ends extended off the edge.
 */
export function splitAtAntimeridian(points: [number, number][]): [number, number][][] {
  if (points.length < 2) {
    return points.length ? [points] : [];
  }
  const segments: [number, number][][] = [];
  let current: [number, number][] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const [prevLon, prevLat] = points[i - 1];
    const [lon, lat] = points[i];
    const delta = lon - prevLon;

    if (Math.abs(delta) > 180) {
      // Crossing: interpolate the latitude at the edge and finish this segment there.
      const direction = delta > 0 ? -1 : 1;
      const prevEdge = direction * 180;
      const nextEdge = -direction * 180;
      const spanToEdge = Math.abs(prevEdge - prevLon);
      const totalSpan = 360 - Math.abs(delta);
      const t = totalSpan === 0 ? 0 : spanToEdge / totalSpan;
      const edgeLat = prevLat + (lat - prevLat) * t;

      current.push([prevEdge, edgeLat]);
      segments.push(current);
      current = [
        [nextEdge, edgeLat],
        [lon, lat],
      ];
    } else {
      current.push([lon, lat]);
    }
  }

  segments.push(current);
  return segments.filter((segment) => segment.length > 1);
}

/** Geographic bounding box of a set of positions, aware of the date line. */
export function boundsOf(positions: { lat: number; lon: number }[]): {
  minLat: number;
  maxLat: number;
  centerLat: number;
  centerLon: number;
  spanLat: number;
  spanLon: number;
} | null {
  if (positions.length === 0) {
    return null;
  }

  let minLat = 90;
  let maxLat = -90;
  // Longitudes are averaged as unit vectors so a cluster either side of the date line still yields a
  // sensible centre rather than snapping back to zero.
  let sumX = 0;
  let sumZ = 0;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;

  for (const position of positions) {
    minLat = Math.min(minLat, position.lat);
    maxLat = Math.max(maxLat, position.lat);
    const theta = position.lon * DEG_TO_RAD;
    sumX += Math.sin(theta);
    sumZ += Math.cos(theta);
  }

  const centerLon = Math.atan2(sumX / positions.length, sumZ / positions.length) * RAD_TO_DEG;
  for (const position of positions) {
    const relative = normalizeLon(position.lon - centerLon);
    minLon = Math.min(minLon, relative);
    maxLon = Math.max(maxLon, relative);
  }

  return {
    minLat,
    maxLat,
    centerLat: (minLat + maxLat) / 2,
    centerLon: normalizeLon(centerLon),
    spanLat: maxLat - minLat,
    spanLon: maxLon - minLon,
  };
}
