/**
 * The latitude and longitude grid.
 *
 * Off by default, but useful when the map is being read for position rather than for shape.
 */

import { lonLatToVec3 } from '../math/geo.ts';

/** Degrees between samples along each grid line, fine enough that the curve reads as smooth. */
const SAMPLE_STEP = 5;

/** Build the grid as a set of paths of interleaved x/y/z positions. */
export function buildGraticule(radius: number, step: number): Float32Array[] {
  const spacing = Math.max(5, Math.min(45, step));
  const paths: Float32Array[] = [];

  // Meridians, stopping short of the poles so they do not all pile up on the same point.
  for (let lon = -180; lon < 180; lon += spacing) {
    const points: number[] = [];
    for (let lat = -90; lat <= 90; lat += SAMPLE_STEP) {
      const position = lonLatToVec3(lon, lat, radius);
      points.push(position[0], position[1], position[2]);
    }
    paths.push(Float32Array.from(points));
  }

  // Parallels.
  for (let lat = -90 + spacing; lat < 90; lat += spacing) {
    const points: number[] = [];
    for (let lon = -180; lon <= 180; lon += SAMPLE_STEP) {
      const position = lonLatToVec3(lon, lat, radius);
      points.push(position[0], position[1], position[2]);
    }
    paths.push(Float32Array.from(points));
  }

  return paths;
}
