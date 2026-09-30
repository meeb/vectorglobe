/**
 * Land geometry for the 3D renderer.
 *
 * Countries are triangulated flat in longitude and latitude, then lifted onto the globe. A triangle
 * that spans a wide arc would cut a chord straight through the sphere and sink below the surface, so
 * long edges are subdivided first.
 *
 * Subdivision decides per edge, purely from that edge's two endpoints, which means the triangle on
 * the other side of a shared edge always makes the same decision and arrives at the same midpoint.
 * That is what keeps the surface watertight instead of leaving hairline cracks where water shows
 * through.
 */

import type { World } from '../data/world.ts';
import { ringCoordinates } from '../data/world.ts';
import { lonLatToVec3 } from '../math/geo.ts';
import { triangulatePolygon } from './triangulate.ts';

/** Longest edge, in degrees, left unsubdivided. */
const MAX_EDGE_DEGREES = 4;

/** Depth limit, a safety net against a pathological triangle recursing forever. */
const MAX_DEPTH = 6;

interface Builder {
  positions: number[];
  radius: number;
}

function edgeTooLong(ax: number, ay: number, bx: number, by: number): boolean {
  // Compared in degrees, scaling longitude by latitude so a span near the poles is not overstated.
  const meanLat = ((ay + by) / 2) * (Math.PI / 180);
  const dx = (bx - ax) * Math.cos(meanLat);
  const dy = by - ay;
  return Math.hypot(dx, dy) > MAX_EDGE_DEGREES;
}

function emitVertex(builder: Builder, lon: number, lat: number): void {
  const position = lonLatToVec3(lon, lat, builder.radius);
  builder.positions.push(position[0], position[1], position[2]);
}

/**
 * Emit one triangle, subdividing it first if any of its edges spans too much of the globe.
 *
 * Which edges are too long decides the split pattern, following the usual one, two or three edge
 * cases so that every piece stays a triangle and no vertex is left hanging in the middle of a
 * neighbour's edge.
 */
function emitTriangle(
  builder: Builder,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  depth: number,
): void {
  const splitAB = depth < MAX_DEPTH && edgeTooLong(ax, ay, bx, by);
  const splitBC = depth < MAX_DEPTH && edgeTooLong(bx, by, cx, cy);
  const splitCA = depth < MAX_DEPTH && edgeTooLong(cx, cy, ax, ay);
  const splits = (splitAB ? 1 : 0) + (splitBC ? 1 : 0) + (splitCA ? 1 : 0);

  if (splits === 0) {
    emitVertex(builder, ax, ay);
    emitVertex(builder, bx, by);
    emitVertex(builder, cx, cy);
    return;
  }

  const mABx = (ax + bx) / 2;
  const mABy = (ay + by) / 2;
  const mBCx = (bx + cx) / 2;
  const mBCy = (by + cy) / 2;
  const mCAx = (cx + ax) / 2;
  const mCAy = (cy + ay) / 2;
  const next = depth + 1;

  if (splits === 3) {
    emitTriangle(builder, ax, ay, mABx, mABy, mCAx, mCAy, next);
    emitTriangle(builder, mABx, mABy, bx, by, mBCx, mBCy, next);
    emitTriangle(builder, mCAx, mCAy, mBCx, mBCy, cx, cy, next);
    emitTriangle(builder, mABx, mABy, mBCx, mBCy, mCAx, mCAy, next);
    return;
  }

  if (splits === 1) {
    if (splitAB) {
      emitTriangle(builder, ax, ay, mABx, mABy, cx, cy, next);
      emitTriangle(builder, mABx, mABy, bx, by, cx, cy, next);
    } else if (splitBC) {
      emitTriangle(builder, bx, by, mBCx, mBCy, ax, ay, next);
      emitTriangle(builder, mBCx, mBCy, cx, cy, ax, ay, next);
    } else {
      emitTriangle(builder, cx, cy, mCAx, mCAy, bx, by, next);
      emitTriangle(builder, mCAx, mCAy, ax, ay, bx, by, next);
    }
    return;
  }

  // Two edges split: cut from the corner they share, then split the remaining quad.
  if (!splitCA) {
    emitTriangle(builder, bx, by, mBCx, mBCy, mABx, mABy, next);
    emitTriangle(builder, mABx, mABy, mBCx, mBCy, cx, cy, next);
    emitTriangle(builder, ax, ay, mABx, mABy, cx, cy, next);
  } else if (!splitAB) {
    emitTriangle(builder, cx, cy, mCAx, mCAy, mBCx, mBCy, next);
    emitTriangle(builder, mBCx, mBCy, mCAx, mCAy, ax, ay, next);
    emitTriangle(builder, bx, by, mBCx, mBCy, ax, ay, next);
  } else {
    emitTriangle(builder, ax, ay, mABx, mABy, mCAx, mCAy, next);
    emitTriangle(builder, mCAx, mCAy, mABx, mABy, bx, by, next);
    emitTriangle(builder, cx, cy, mCAx, mCAy, bx, by, next);
  }
}

/**
 * Build the land surface as non-indexed triangles in globe space.
 *
 * Non-indexed keeps the buffer layout trivial and sidesteps the 16 bit index limit that older WebGL
 * implementations impose, at a cost in memory that is irrelevant at this scale.
 */
export function buildLandMesh(world: World, radius: number): Float32Array {
  const builder: Builder = { positions: [], radius };

  for (const polygons of world.shapes) {
    for (const rings of polygons) {
      const coordinateRings = rings.map((ring) => ringCoordinates(world.arcs, ring));
      const { coords, indices } = triangulatePolygon(coordinateRings);
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 2;
        const b = indices[i + 1] * 2;
        const c = indices[i + 2] * 2;
        emitTriangle(
          builder,
          coords[a],
          coords[a + 1],
          coords[b],
          coords[b + 1],
          coords[c],
          coords[c + 1],
          0,
        );
      }
    }
  }

  return Float32Array.from(builder.positions);
}

/** How many pieces a segment needs so that no piece spans more than the maximum edge length. */
function subdivisions(ax: number, ay: number, bx: number, by: number): number {
  const meanLat = ((ay + by) / 2) * (Math.PI / 180);
  const dx = (bx - ax) * Math.cos(meanLat);
  const dy = by - ay;
  return Math.max(1, Math.ceil(Math.hypot(dx, dy) / MAX_EDGE_DEGREES));
}

/**
 * Collect border lines as paths in globe space.
 *
 * Arcs are shared between neighbouring countries, so walking the arc list draws every border exactly
 * once. Arcs used by a single country are coastlines and are returned separately so the two can be
 * themed differently.
 */
export function buildBorderPaths(
  world: World,
  radius: number,
): { borders: Float32Array[]; coastlines: Float32Array[] } {
  const borders: Float32Array[] = [];
  const coastlines: Float32Array[] = [];
  const arcCount = world.arcs.offsets.length - 1;

  for (let index = 0; index < arcCount; index++) {
    const start = world.arcs.offsets[index];
    const end = world.arcs.offsets[index + 1];
    const count = end - start;
    if (count < 2) {
      continue;
    }

    // Simplification leaves some very long straight segments, such as the ruled borders across the
    // Sahara. Drawn as a single chord they would pass under the surface, so they are walked along
    // the sphere instead.
    const points: number[] = [];
    for (let i = 0; i < count - 1; i++) {
      const lon = world.arcs.coords[(start + i) * 2];
      const lat = world.arcs.coords[(start + i) * 2 + 1];
      const nextLon = world.arcs.coords[(start + i + 1) * 2];
      const nextLat = world.arcs.coords[(start + i + 1) * 2 + 1];
      const steps = subdivisions(lon, lat, nextLon, nextLat);
      for (let step = 0; step < steps; step++) {
        const t = step / steps;
        points.push(lon + (nextLon - lon) * t, lat + (nextLat - lat) * t);
      }
    }
    points.push(world.arcs.coords[(end - 1) * 2], world.arcs.coords[(end - 1) * 2 + 1]);

    const path = new Float32Array((points.length / 2) * 3);
    for (let i = 0; i < points.length / 2; i++) {
      const position = lonLatToVec3(points[i * 2], points[i * 2 + 1], radius);
      path[i * 3] = position[0];
      path[i * 3 + 1] = position[1];
      path[i * 3 + 2] = position[2];
    }

    if (world.arcUse[index] > 1) {
      borders.push(path);
    } else {
      coastlines.push(path);
    }
  }

  return { borders, coastlines };
}
