/**
 * Flat map projection.
 *
 * The 2D renderer reuses the camera as-is: `lat` and `lon` are the centre of the view and `altitude`
 * is the zoom, so switching between renderers keeps the map looking at the same place.
 *
 * Longitude is handled in absolute degrees rather than being wrapped, and the renderer instead draws
 * a copy of the world either side of the middle one. That keeps every shape and every route in one
 * continuous piece, which is much easier to reason about than cutting geometry at the date line.
 */

import type { Projection } from '../../types.ts';

/** Altitude at which exactly 360 degrees of longitude spans the container width. */
const REFERENCE_ALTITUDE = 2.5;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Latitude beyond which Mercator runs away to infinity. */
const MERCATOR_LIMIT = 85.05112878;

export class FlatProjection {
  /** Pixels per degree of longitude. */
  readonly scale: number;
  readonly centerLon: number;
  readonly centerLat: number;
  readonly width: number;
  readonly height: number;
  readonly kind: Projection;

  constructor(
    width: number,
    height: number,
    centerLon: number,
    centerLat: number,
    altitude: number,
    kind: Projection,
  ) {
    this.width = width;
    this.height = height;
    this.centerLon = centerLon;
    this.centerLat = centerLat;
    this.kind = kind;
    // Zoom is inversely proportional to height above the surface, matching how the 3D camera feels.
    const zoom = (REFERENCE_ALTITUDE - 1) / Math.max(0.05, altitude - 1);
    this.scale = (width * zoom) / 360;
  }

  /** Width of one whole world in pixels, used to place the repeated copies. */
  get worldWidth(): number {
    return this.scale * 360;
  }

  /** Vertical position of a latitude, in the projection's own units of degrees. */
  private latitudeUnits(lat: number): number {
    if (this.kind === 'mercator') {
      const clamped = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, lat));
      return Math.log(Math.tan(Math.PI / 4 + (clamped * DEG_TO_RAD) / 2)) * RAD_TO_DEG;
    }
    return lat;
  }

  /** Project a geographic position to container pixels, without any date line wrapping. */
  project(lon: number, lat: number): [number, number] {
    const x = this.width / 2 + (lon - this.centerLon) * this.scale;
    const y =
      this.height / 2 - (this.latitudeUnits(lat) - this.latitudeUnits(this.centerLat)) * this.scale;
    return [x, y];
  }

  /** Reverse of {@link project}. Longitude comes back wrapped into the usual range. */
  unproject(x: number, y: number): [number, number] {
    const lon = this.centerLon + (x - this.width / 2) / this.scale;
    const units = this.latitudeUnits(this.centerLat) - (y - this.height / 2) / this.scale;

    let lat: number;
    if (this.kind === 'mercator') {
      lat = (2 * Math.atan(Math.exp(units * DEG_TO_RAD)) - Math.PI / 2) * RAD_TO_DEG;
    } else {
      lat = units;
    }

    const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
    return [wrapped, Math.max(-90, Math.min(90, lat))];
  }

  /** Horizontal offsets, in pixels, of every copy of the world that is currently on screen. */
  visibleCopies(): number[] {
    const world = this.worldWidth;
    if (world <= 0) {
      return [0];
    }
    const offsets: number[] = [];
    // Work out which copies overlap the container instead of always drawing a fixed three.
    const first = Math.floor(
      (0 - (this.width / 2 - this.centerLon * this.scale + 180 * this.scale)) / world,
    );
    const last = Math.ceil(
      (this.width - (this.width / 2 - this.centerLon * this.scale - 180 * this.scale)) / world,
    );
    for (let i = first; i <= last; i++) {
      offsets.push(i * world);
    }
    return offsets.length > 0 ? offsets : [0];
  }

  /** Vertical extent of the world, used to fill the ocean and to clip drawing. */
  verticalBounds(): [number, number] {
    const top = this.project(this.centerLon, this.kind === 'mercator' ? MERCATOR_LIMIT : 90)[1];
    const bottom = this.project(
      this.centerLon,
      this.kind === 'mercator' ? -MERCATOR_LIMIT : -90,
    )[1];
    return [top, bottom];
  }
}

/**
 * Unwrap a run of longitudes so consecutive values never jump across the date line.
 *
 * A route sampled along a great circle from Tokyo to Los Angeles produces longitudes that step from
 * 179 to -179. Left alone that draws a line straight back across the map, so each value is shifted
 * into the same continuous space as the one before it.
 */
export function unwrapLongitudes(points: number[]): void {
  for (let i = 2; i < points.length; i += 2) {
    const previous = points[i - 2];
    let lon = points[i];
    while (lon - previous > 180) {
      lon -= 360;
    }
    while (lon - previous < -180) {
      lon += 360;
    }
    points[i] = lon;
  }
}
