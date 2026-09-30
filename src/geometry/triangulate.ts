/**
 * Polygon triangulation by ear clipping.
 *
 * Country outlines arrive as a filled outer ring plus any holes, and the GPU needs triangles. The
 * input comes out of the sync pipeline already cleaned, so the rings are simple and non
 * self-intersecting, which is what makes a compact ear clipper sufficient here rather than needing a
 * general purpose library.
 *
 * Everything works in longitude and latitude; lifting the result onto the globe happens afterwards in
 * `landmesh.ts`, so this module is a plain 2D triangulator and is tested as one.
 */

/** Result of triangulating one polygon. */
export interface Triangulation {
  /** Interleaved x/y (longitude/latitude) pairs, including any vertices duplicated to bridge holes. */
  coords: Float64Array;
  /** Triangle corners as indices into `coords`, three per triangle. */
  indices: number[];
  /** Vertices the clipper had to force through because no valid ear was found. Zero for clean input. */
  degenerate: number;
}

/** Twice the signed area of a triangle. Positive when the corners wind counter-clockwise. */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Twice the signed area of a ring, used to detect and fix winding order.
 *
 * Positive means the ring winds counter-clockwise, which is the direction the ear clipper expects.
 */
function signedArea(coords: ArrayLike<number>, length = coords.length): number {
  let area = 0;
  for (let i = 0, j = length - 2; i < length; j = i, i += 2) {
    area += coords[j] * coords[i + 1] - coords[i] * coords[j + 1];
  }
  return area;
}

function pointInTriangle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  const d1 = cross(ax, ay, bx, by, px, py);
  const d2 = cross(bx, by, cx, cy, px, py);
  const d3 = cross(cx, cy, ax, ay, px, py);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

/** Reverse a ring in place, flipping its winding. */
function reverseRing(ring: number[]): void {
  for (let i = 0, j = ring.length - 2; i < j; i += 2, j -= 2) {
    const x = ring[i];
    const y = ring[i + 1];
    ring[i] = ring[j];
    ring[i + 1] = ring[j + 1];
    ring[j] = x;
    ring[j + 1] = y;
  }
}

/** Strip the repeated closing coordinate a GeoJSON ring carries. */
function openRing(ring: ArrayLike<number>): number[] {
  const points: number[] = [];
  const count = ring.length / 2;
  for (let i = 0; i < count; i++) {
    points.push(ring[i * 2], ring[i * 2 + 1]);
  }
  if (points.length >= 4) {
    const lastX = points[points.length - 2];
    const lastY = points[points.length - 1];
    if (lastX === points[0] && lastY === points[1]) {
      points.length -= 2;
    }
  }
  return points;
}

/**
 * Merge a hole into the outer ring by cutting a bridge between them.
 *
 * The bridge runs from the hole's rightmost vertex to a visible outer vertex, which turns a polygon
 * with a hole into a single ring that the ear clipper can treat normally. Both bridge endpoints are
 * duplicated, which is why the returned vertex list is longer than the input.
 */
function bridgeHole(outer: number[], hole: number[]): number[] {
  // Leftmost vertex of the hole; the bridge always leaves from here heading left.
  let holeStart = 0;
  for (let i = 0; i < hole.length; i += 2) {
    if (hole[i] < hole[holeStart]) {
      holeStart = i;
    }
  }
  const hx = hole[holeStart];
  const hy = hole[holeStart + 1];

  // Cast a ray to the left and keep the nearest outer edge it crosses.
  let reachX = Number.NEGATIVE_INFINITY;
  let bridge = -1;
  for (let i = 0; i < outer.length; i += 2) {
    const j = (i + 2) % outer.length;
    const ax = outer[i];
    const ay = outer[i + 1];
    const bx = outer[j];
    const by = outer[j + 1];
    // Only edges spanning the hole's latitude can be hit, counted once by testing one direction.
    if (hy > ay || hy < by || ay === by) {
      continue;
    }
    const x = ax + ((hy - ay) / (by - ay)) * (bx - ax);
    if (x <= hx && x > reachX) {
      reachX = x;
      // The endpoint nearer the hole is the candidate to bridge to.
      bridge = ax > bx ? i : j;
    }
  }

  if (bridge < 0) {
    // The hole is not enclosed by the outer ring, which should not happen with cleaned input.
    return outer;
  }

  // The straight bridge may be blocked by a vertex poking into it, so prefer the vertex at the
  // shallowest angle from the ray among those inside the triangle the bridge sweeps through.
  const bridgeX = outer[bridge];
  const bridgeY = outer[bridge + 1];
  let chosen = bridge;
  let bestTangent = Number.POSITIVE_INFINITY;
  for (let i = 0; i < outer.length; i += 2) {
    const px = outer[i];
    const py = outer[i + 1];
    if (px > hx || px < bridgeX || px === hx) {
      continue;
    }
    const inside =
      hy < bridgeY
        ? pointInTriangle(hx, hy, bridgeX, bridgeY, reachX, hy, px, py)
        : pointInTriangle(reachX, hy, bridgeX, bridgeY, hx, hy, px, py);
    if (!inside) {
      continue;
    }
    const tangent = Math.abs(hy - py) / (hx - px);
    if (tangent < bestTangent) {
      bestTangent = tangent;
      chosen = i;
    }
  }

  // Splice the hole into the outer ring, duplicating both ends of the bridge.
  const merged: number[] = [];
  for (let i = 0; i <= chosen; i += 2) {
    merged.push(outer[i], outer[i + 1]);
  }
  for (let k = 0; k < hole.length; k += 2) {
    const i = (holeStart + k) % hole.length;
    merged.push(hole[i], hole[i + 1]);
  }
  merged.push(hx, hy);
  merged.push(outer[chosen], outer[chosen + 1]);
  for (let i = chosen + 2; i < outer.length; i += 2) {
    merged.push(outer[i], outer[i + 1]);
  }
  return merged;
}

/**
 * Triangulate a polygon given as an outer ring followed by hole rings.
 *
 * Rings are lists of interleaved x/y pairs and may be closed or open.
 */
export function triangulatePolygon(rings: ArrayLike<number>[]): Triangulation {
  if (rings.length === 0) {
    return { coords: new Float64Array(0), indices: [], degenerate: 0 };
  }

  let vertices = openRing(rings[0]);
  if (vertices.length < 6) {
    return { coords: Float64Array.from(vertices), indices: [], degenerate: 0 };
  }

  // Bridging searches leftwards for the enclosing edge, which only identifies the correct side when
  // the outer ring runs counter-clockwise and each hole runs the other way.
  if (signedArea(vertices) < 0) {
    reverseRing(vertices);
  }
  for (let h = 1; h < rings.length; h++) {
    const hole = openRing(rings[h]);
    if (hole.length < 6) {
      continue;
    }
    if (signedArea(hole) > 0) {
      reverseRing(hole);
    }
    vertices = bridgeHole(vertices, hole);
  }

  const coords = Float64Array.from(vertices);
  const count = coords.length / 2;
  const indices: number[] = [];

  // Ear clipping wants a consistent winding; normalise to counter-clockwise.
  const clockwise = signedArea(coords) < 0;
  const order: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    order[i] = clockwise ? count - 1 - i : i;
  }

  const prev = new Int32Array(count);
  const next = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    prev[i] = (i + count - 1) % count;
    next[i] = (i + 1) % count;
  }

  const x = (i: number): number => coords[order[i] * 2];
  const y = (i: number): number => coords[order[i] * 2 + 1];

  let remaining = count;
  let current = 0;
  let sinceProgress = 0;
  let degenerate = 0;

  while (remaining > 3) {
    const a = prev[current];
    const b = current;
    const c = next[current];
    const area = cross(x(a), y(a), x(b), y(b), x(c), y(c));

    let isEar = area > 0;
    if (isEar) {
      // Reject the ear if any other vertex of the polygon falls inside it. Bridging a hole leaves
      // two pairs of coincident vertices behind, and those sit exactly on the corners of the ears
      // around them, so a vertex at the same position as a corner is not treated as blocking.
      for (let probe = next[c]; probe !== a; probe = next[probe]) {
        const px = x(probe);
        const py = y(probe);
        if (
          (px === x(a) && py === y(a)) ||
          (px === x(b) && py === y(b)) ||
          (px === x(c) && py === y(c))
        ) {
          continue;
        }
        if (pointInTriangle(x(a), y(a), x(b), y(b), x(c), y(c), px, py)) {
          isEar = false;
          break;
        }
      }
    }

    if (isEar) {
      indices.push(order[a], order[b], order[c]);
      next[a] = c;
      prev[c] = a;
      remaining--;
      sinceProgress = 0;
      current = c;
      continue;
    }

    current = next[current];
    sinceProgress++;

    if (sinceProgress > remaining) {
      // No ear anywhere, which means the input was not as clean as expected. Force progress by
      // dropping the thinnest corner so a bad polygon degrades rather than hanging the page.
      let worst = current;
      let worstArea = Number.POSITIVE_INFINITY;
      let node = current;
      for (let i = 0; i < remaining; i++) {
        const pa = prev[node];
        const pc = next[node];
        const nodeArea = Math.abs(cross(x(pa), y(pa), x(node), y(node), x(pc), y(pc)));
        if (nodeArea < worstArea) {
          worstArea = nodeArea;
          worst = node;
        }
        node = next[node];
      }
      const a2 = prev[worst];
      const c2 = next[worst];
      indices.push(order[a2], order[worst], order[c2]);
      next[a2] = c2;
      prev[c2] = a2;
      remaining--;
      degenerate++;
      sinceProgress = 0;
      current = c2;
    }
  }

  if (remaining === 3) {
    const a = prev[current];
    indices.push(order[a], order[current], order[next[current]]);
  }

  return { coords, indices, degenerate };
}
