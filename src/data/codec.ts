/**
 * Binary codec for the embedded world geometry.
 *
 * The world data is stored in the bundle as base64 text. Coordinates are quantised onto a fixed
 * whole-world grid, delta encoded along each arc and written as zigzag varints, which is what keeps
 * roughly 8000 coordinate pairs down to around twenty kilobytes of source.
 *
 * This module is shared by the `make sync` build script and the runtime, so it must stay free of any
 * Node specific API.
 */

/** Steps per axis on the quantisation grid. 16 bits gives ~600m resolution at the equator. */
export const WORLD_GRID = 65536;

/** Format version written into every payload, bumped if the layout ever changes. */
export const CODEC_VERSION = 1;

/** A ring is a list of arc references, using the TopoJSON convention where ~n means reversed. */
export type Ring = number[];

/** A polygon is an outer ring followed by any number of hole rings. */
export type Polygon = Ring[];

/** Arc coordinates flattened into one buffer, with an index of where each arc starts. */
export interface ArcSet {
  /** Interleaved lon/lat pairs for every arc, back to back. */
  coords: Float32Array;
  /** Start offset of each arc in `coords`, in coordinate pairs. Length is arcCount + 1. */
  offsets: Uint32Array;
}

const LON_SPAN = 360;
const LAT_SPAN = 180;
const GRID_MAX = WORLD_GRID - 1;

class ByteWriter {
  private bytes: number[] = [];

  varint(value: number): void {
    let v = value >>> 0;
    while (v > 0x7f) {
      this.bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.bytes.push(v);
  }

  signed(value: number): void {
    this.varint(((value << 1) ^ (value >> 31)) >>> 0);
  }

  toBase64(): string {
    let binary = '';
    // Chunked so a large payload cannot blow the argument limit of String.fromCharCode.
    for (let i = 0; i < this.bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, this.bytes.slice(i, i + 0x8000));
    }
    return btoa(binary);
  }
}

class ByteReader {
  private pos = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.bytes[this.pos++];
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return result >>> 0;
  }

  signed(): number {
    const v = this.varint();
    return (v >>> 1) ^ -(v & 1);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Snap a longitude onto the quantisation grid. */
export function quantiseLon(lon: number): number {
  return Math.round(((lon + 180) / LON_SPAN) * GRID_MAX);
}

/** Snap a latitude onto the quantisation grid. */
export function quantiseLat(lat: number): number {
  return Math.round(((lat + 90) / LAT_SPAN) * GRID_MAX);
}

/**
 * Encode arcs given as lists of [lon, lat] pairs.
 *
 * Consecutive points that collapse onto the same grid cell after quantisation are dropped, but arcs
 * themselves are never dropped: shape rings reference arcs by index, so the indices must stay stable.
 */
export function encodeArcs(arcs: number[][][]): string {
  const writer = new ByteWriter();
  writer.varint(CODEC_VERSION);
  writer.varint(WORLD_GRID);
  writer.varint(arcs.length);

  for (const arc of arcs) {
    const qx: number[] = [];
    const qy: number[] = [];
    for (const point of arc) {
      const x = quantiseLon(point[0]);
      const y = quantiseLat(point[1]);
      if (qx.length > 0 && qx[qx.length - 1] === x && qy[qy.length - 1] === y) {
        continue;
      }
      qx.push(x);
      qy.push(y);
    }
    writer.varint(qx.length);
    let prevX = 0;
    let prevY = 0;
    for (let i = 0; i < qx.length; i++) {
      writer.signed(qx[i] - prevX);
      writer.signed(qy[i] - prevY);
      prevX = qx[i];
      prevY = qy[i];
    }
  }

  return writer.toBase64();
}

/** Decode a payload written by {@link encodeArcs} back into lon/lat coordinates. */
export function decodeArcs(payload: string): ArcSet {
  const reader = new ByteReader(base64ToBytes(payload));
  const version = reader.varint();
  if (version !== CODEC_VERSION) {
    throw new Error(`vectorglobe: unsupported world data version ${version}`);
  }
  const gridMax = reader.varint() - 1;
  const arcCount = reader.varint();

  // Two passes are avoided by reading into a growable plain array first; the data is small enough
  // that one copy into a Float32Array at the end is cheaper than decoding the payload twice.
  const offsets = new Uint32Array(arcCount + 1);
  const values: number[] = [];

  for (let a = 0; a < arcCount; a++) {
    offsets[a] = values.length / 2;
    const pointCount = reader.varint();
    let x = 0;
    let y = 0;
    for (let i = 0; i < pointCount; i++) {
      x += reader.signed();
      y += reader.signed();
      values.push((x / gridMax) * LON_SPAN - 180, (y / gridMax) * LAT_SPAN - 90);
    }
  }
  offsets[arcCount] = values.length / 2;

  return { coords: Float32Array.from(values), offsets };
}

/** Encode per-country shapes: country -> polygon -> ring -> arc references. */
export function encodeShapes(shapes: Polygon[][]): string {
  const writer = new ByteWriter();
  writer.varint(shapes.length);
  for (const polygons of shapes) {
    writer.varint(polygons.length);
    for (const rings of polygons) {
      writer.varint(rings.length);
      for (const ring of rings) {
        writer.varint(ring.length);
        for (const ref of ring) {
          writer.signed(ref);
        }
      }
    }
  }
  return writer.toBase64();
}

/** Decode a payload written by {@link encodeShapes}. */
export function decodeShapes(payload: string): Polygon[][] {
  const reader = new ByteReader(base64ToBytes(payload));
  const countryCount = reader.varint();
  const shapes: Polygon[][] = new Array(countryCount);
  for (let c = 0; c < countryCount; c++) {
    const polygonCount = reader.varint();
    const polygons: Polygon[] = new Array(polygonCount);
    for (let p = 0; p < polygonCount; p++) {
      const ringCount = reader.varint();
      const rings: Ring[] = new Array(ringCount);
      for (let r = 0; r < ringCount; r++) {
        const refCount = reader.varint();
        const ring: Ring = new Array(refCount);
        for (let i = 0; i < refCount; i++) {
          ring[i] = reader.signed();
        }
        rings[r] = ring;
      }
      polygons[p] = rings;
    }
    shapes[c] = polygons;
  }
  return shapes;
}

/** Resolve a TopoJSON style arc reference to its index and direction. */
export function resolveArcRef(ref: number): { index: number; reversed: boolean } {
  return ref < 0 ? { index: ~ref, reversed: true } : { index: ref, reversed: false };
}
