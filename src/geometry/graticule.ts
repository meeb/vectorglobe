/**
 * The latitude and longitude grid.
 *
 * Off by default, but useful when the map is being read for position rather than for shape.
 */

import { lonLatToVec3 } from '../math/geo.ts';

/**
 * Degrees between samples along each grid line.
 *
 * Each sample pair is joined by a straight 3D chord, not a further-curved line, and that chord dips
 * below the sphere it is meant to trace - its sagitta grows with the square of the sample spacing. At
 * the old 5 degree step the sag was about 0.00095 of a globe radius, well past the 0.0002 gap
 * `LAYER_RADIUS.graticule` keeps above land: every chord's middle sat under the land surface and
 * depth-tested as hidden. Harmless-looking zoomed out, where that gap is far below what the depth
 * buffer can even resolve, but exact enough to show every time once zoomed in closer sharpens the
 * buffer's precision - the grid then reads as dashed rather than drawn, breaking up more the closer
 * the camera gets. At 1 degree the sag is about 0.000038, comfortably inside the gap at any zoom.
 */
const SAMPLE_STEP = 1;

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
