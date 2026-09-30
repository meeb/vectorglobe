import { describe, expect, it } from 'vitest';
import { getWorld, ringCoordinates, type World } from '../src/data/world.ts';
import { buildBorderPaths, buildLandMesh } from '../src/geometry/landmesh.ts';
import { triangulatePolygon } from '../src/geometry/triangulate.ts';
import { vec3ToLonLat } from '../src/math/geo.ts';

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

/** Build a minimal World whose only arc is the given lon/lat points, for testing in isolation. */
function worldFromArc(points: [number, number][]): World {
  const coords = new Float32Array(points.length * 2);
  points.forEach(([lon, lat], i) => {
    coords[i * 2] = lon;
    coords[i * 2 + 1] = lat;
  });
  return {
    arcs: { coords, offsets: new Uint32Array([0, points.length]) },
    shapes: [],
    countries: [],
    arcUse: new Uint8Array([1]),
    meta: getWorld().meta,
  };
}

describe('border and coastline paths', () => {
  it('draws an ordinary arc as a single unbroken path', () => {
    const world = worldFromArc([
      [10, -10],
      [12, -12],
      [14, -11],
    ]);
    const { coastlines } = buildBorderPaths(world, 1);
    expect(coastlines.length).toBe(1);
  });

  it('does not draw a line through a Antarctica-style polar ring closure', () => {
    // Shaped like the real data: real coastline, a sweep around the pole at ~constant latitude,
    // then a climb back up to real coastline at a constant, ~antimeridian longitude - see
    // isArtificialClosurePoint in landmesh.ts for why both parts need their own rule to catch. The
    // exact point where real coastline meets the antimeridian is itself indistinguishable from the
    // closure and is trimmed along with it (as it is in the real data), so a couple of ordinary
    // points are included either side of that boundary for the path to still have something to draw.
    const world = worldFromArc([
      [165, -82],
      [170, -83],
      [180, -84.35], // last real coastal point - sits exactly on the antimeridian, trimmed too
      [180, -89.99], // sweep starts
      [90, -89.99],
      [0, -89.99],
      [-90, -89.99],
      [-180, -89.99], // sweep ends, back at the antimeridian
      [-180, -87], // climbing back up at constant longitude
      [-180, -84.35], // first point back - also on the antimeridian, also trimmed
      [-170, -84.5], // real coastline resumes
      [-165, -84],
      [-160, -83],
    ]);
    const { coastlines } = buildBorderPaths(world, 1);

    // The closure breaks the arc into two real pieces either side of the gap, not one path that
    // cuts across it and not zero paths that lose the real coastline entirely.
    expect(coastlines.length).toBe(2);
    for (const path of coastlines) {
      for (let i = 0; i < path.length; i += 3) {
        const [, lat] = vec3ToLonLat([path[i], path[i + 1], path[i + 2]]);
        // Every remaining point is real coastline, nowhere near the pole or the closure.
        expect(lat).toBeGreaterThan(-86);
      }
    }
  });

  it('keeps every point of an ordinary long meridian-following border', () => {
    // A real border can legitimately run along a meridian for a couple of degrees; only a run at
    // extreme southern latitude on the antimeridian specifically is treated as artificial.
    const world = worldFromArc([
      [30, 40],
      [30, 42],
      [30, 44],
    ]);
    const { coastlines } = buildBorderPaths(world, 1);
    expect(coastlines.length).toBe(1);
  });

  it('never puts a real-world coastline or border point near a pole', () => {
    const world = getWorld();
    const { borders, coastlines } = buildBorderPaths(world, 1);
    for (const path of [...borders, ...coastlines]) {
      for (let i = 0; i < path.length; i += 3) {
        const [, lat] = vec3ToLonLat([path[i], path[i + 1], path[i + 2]]);
        // Antarctica's real coastline reaches into the mid -80s; nothing genuine gets much closer.
        expect(Math.abs(lat)).toBeLessThan(87);
      }
    }
  });
});
