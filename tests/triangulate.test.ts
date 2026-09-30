import { describe, expect, it } from 'vitest';
import { getWorld, ringCoordinates } from '../src/data/world.ts';
import { buildLandMesh } from '../src/geometry/landmesh.ts';
import { triangulatePolygon } from '../src/geometry/triangulate.ts';

/** Area of a ring by the shoelace formula, ignoring winding. */
function ringArea(ring: ArrayLike<number>): number {
  let area = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    area += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  }
  return Math.abs(area / 2);
}

/** Total area of a triangulation. */
function triangleArea(coords: Float64Array, indices: number[]): number {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 2;
    const b = indices[i + 1] * 2;
    const c = indices[i + 2] * 2;
    area +=
      Math.abs(
        (coords[b] - coords[a]) * (coords[c + 1] - coords[a + 1]) -
          (coords[b + 1] - coords[a + 1]) * (coords[c] - coords[a]),
      ) / 2;
  }
  return area;
}

describe('triangulation', () => {
  it('splits a square into two triangles', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
    const { coords, indices, degenerate } = triangulatePolygon([square]);
    expect(indices.length / 3).toBe(2);
    expect(degenerate).toBe(0);
    expect(triangleArea(coords, indices)).toBeCloseTo(100, 6);
  });

  it('handles a concave shape without covering the notch', () => {
    // An L shape: the area must come out as the L, not its bounding box.
    const shape = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10, 0, 0];
    const { coords, indices, degenerate } = triangulatePolygon([shape]);
    expect(degenerate).toBe(0);
    expect(triangleArea(coords, indices)).toBeCloseTo(10 * 4 + 4 * 6, 6);
  });

  it('gives the same result whichever way the ring winds', () => {
    const clockwise = [0, 0, 0, 10, 10, 10, 10, 0, 0, 0];
    const result = triangulatePolygon([clockwise]);
    expect(result.degenerate).toBe(0);
    expect(triangleArea(result.coords, result.indices)).toBeCloseTo(100, 6);
  });

  it('cuts a hole out of the shape instead of filling it', () => {
    const outer = [0, 0, 30, 0, 30, 30, 0, 30, 0, 0];
    const hole = [10, 10, 20, 10, 20, 20, 10, 20, 10, 10];
    const { coords, indices, degenerate } = triangulatePolygon([outer, hole]);
    expect(degenerate).toBe(0);
    expect(triangleArea(coords, indices)).toBeCloseTo(900 - 100, 6);
  });

  it('cuts a hole out no matter which way either ring winds', () => {
    const outer = [0, 0, 30, 0, 30, 30, 0, 30, 0, 0];
    const holeReversed = [10, 10, 10, 20, 20, 20, 20, 10, 10, 10];
    const { coords, indices } = triangulatePolygon([outer, holeReversed]);
    expect(triangleArea(coords, indices)).toBeCloseTo(800, 6);
  });

  it('copes with degenerate input rather than hanging', () => {
    expect(triangulatePolygon([]).indices).toEqual([]);
    expect(triangulatePolygon([[0, 0, 1, 1]]).indices).toEqual([]);
  });
});

describe('the embedded world triangulates cleanly', () => {
  const world = getWorld();

  it('conserves the area of every country and never forces a degenerate triangle', () => {
    let forced = 0;
    for (let index = 0; index < world.shapes.length; index++) {
      for (const rings of world.shapes[index]) {
        const coordinateRings = rings.map((ring) => ringCoordinates(world.arcs, ring));
        const expected =
          ringArea(coordinateRings[0]) -
          coordinateRings.slice(1).reduce((total, ring) => total + ringArea(ring), 0);
        const { coords, indices, degenerate } = triangulatePolygon(coordinateRings);
        forced += degenerate;

        if (expected > 1e-6) {
          const actual = triangleArea(coords, indices);
          // A country whose triangles do not add up to its own area has either lost part of itself
          // or covered a hole, and both show as visible damage on the map.
          expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-6);
        }
      }
    }
    expect(forced).toBe(0);
  });
});

describe('land mesh', () => {
  const world = getWorld();
  const mesh = buildLandMesh(world, 1.0005);

  it('produces whole triangles', () => {
    expect(mesh.length % 9).toBe(0);
    expect(mesh.length / 9).toBeGreaterThan(1000);
  });

  it('places every vertex exactly on the requested sphere', () => {
    for (let i = 0; i < mesh.length; i += 3) {
      expect(Math.hypot(mesh[i], mesh[i + 1], mesh[i + 2])).toBeCloseTo(1.0005, 6);
    }
  });

  it('subdivides so no triangle edge cuts a visible chord through the globe', () => {
    let longest = 0;
    for (let i = 0; i < mesh.length; i += 9) {
      for (const [a, b] of [
        [0, 3],
        [3, 6],
        [6, 0],
      ]) {
        longest = Math.max(
          longest,
          Math.hypot(
            mesh[i + b] - mesh[i + a],
            mesh[i + b + 1] - mesh[i + a + 1],
            mesh[i + b + 2] - mesh[i + a + 2],
          ),
        );
      }
    }
    // A chord this long sags below the surface by well under a kilometre.
    expect(longest).toBeLessThan(0.12);
  });
});
