/**
 * The globe sphere and the atmosphere shell.
 *
 * A plain UV sphere is enough: it carries no texture, so the only thing that matters is that the
 * silhouette is round enough not to show facets at the limb.
 */

/** Build a UV sphere as non-indexed triangles of interleaved x/y/z positions. */
export function buildSphere(radius: number, segments: number): Float32Array {
  const longitudes = Math.max(12, Math.floor(segments));
  const latitudes = Math.max(6, Math.floor(segments / 2));
  const positions = new Float32Array(longitudes * latitudes * 6 * 3);
  let offset = 0;

  const vertex = (i: number, j: number): void => {
    const theta = (i / longitudes) * Math.PI * 2;
    const phi = (j / latitudes) * Math.PI - Math.PI / 2;
    const cosPhi = Math.cos(phi);
    positions[offset++] = radius * cosPhi * Math.sin(theta);
    positions[offset++] = radius * Math.sin(phi);
    positions[offset++] = radius * cosPhi * Math.cos(theta);
  };

  for (let i = 0; i < longitudes; i++) {
    for (let j = 0; j < latitudes; j++) {
      vertex(i, j);
      vertex(i + 1, j);
      vertex(i + 1, j + 1);
      vertex(i, j);
      vertex(i + 1, j + 1);
      vertex(i, j + 1);
    }
  }

  return positions;
}
