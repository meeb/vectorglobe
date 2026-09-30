/**
 * Line geometry.
 *
 * WebGL cannot draw a line thicker than one pixel on most implementations, so every line in the map
 * is built from quads instead. Each segment becomes two triangles whose vertices all carry both
 * endpoints of the segment, leaving the shader to work out the sideways offset in screen space.
 */

/** Floats per vertex: start position, end position, then the side and position along the segment. */
export const LINE_STRIDE = 8;

/** Vertices emitted per segment, as two triangles. */
const VERTICES_PER_SEGMENT = 6;

/** Side and along-segment position for each of the six vertices of a segment quad. */
const CORNERS: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [-1, 1],
  [1, 0],
  [1, 1],
  [-1, 1],
];

/** Count the segments in a set of paths, where each path is a run of interleaved x/y/z positions. */
function countSegments(paths: ArrayLike<number>[]): number {
  let segments = 0;
  for (const path of paths) {
    segments += Math.max(0, path.length / 3 - 1);
  }
  return segments;
}

/**
 * Build interleaved vertex data for a set of paths.
 *
 * Segments are emitted independently rather than sharing vertices at the joins. For the line widths
 * this map draws the join gap is invisible, and it keeps the buffer layout flat.
 */
export function buildLineVertices(paths: ArrayLike<number>[]): Float32Array {
  const segments = countSegments(paths);
  const data = new Float32Array(segments * VERTICES_PER_SEGMENT * LINE_STRIDE);
  let offset = 0;

  for (const path of paths) {
    const points = path.length / 3;
    for (let i = 0; i < points - 1; i++) {
      const sx = path[i * 3];
      const sy = path[i * 3 + 1];
      const sz = path[i * 3 + 2];
      const ex = path[(i + 1) * 3];
      const ey = path[(i + 1) * 3 + 1];
      const ez = path[(i + 1) * 3 + 2];

      for (const [side, t] of CORNERS) {
        data[offset++] = sx;
        data[offset++] = sy;
        data[offset++] = sz;
        data[offset++] = ex;
        data[offset++] = ey;
        data[offset++] = ez;
        data[offset++] = side;
        data[offset++] = t;
      }
    }
  }

  return data;
}

/** Number of vertices in the data returned by {@link buildLineVertices}. */
export function lineVertexCount(data: Float32Array): number {
  return data.length / LINE_STRIDE;
}
