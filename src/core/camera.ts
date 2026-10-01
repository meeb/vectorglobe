/**
 * The orbit camera.
 *
 * The camera always looks at a point on the surface given by `lat` and `lon`. `altitude` is how far
 * the eye sits from the centre of the globe in globe radii, `tilt` pitches the eye away from looking
 * straight down, and `bearing` spins the view around the local vertical.
 *
 * The same state drives the 2D renderer, which uses `lat`, `lon` and `altitude` as its centre and
 * zoom and ignores the rest.
 */

import { FIELD_OF_VIEW } from '../defaults.ts';
import { clampLat, lonLatToVec3, normalizeLon } from '../math/geo.ts';
import { lookAt, type Mat4, multiply, perspective } from '../math/mat4.ts';
import { cross, normalize, rotateAroundAxis, scale, sub, type Vec3 } from '../math/vec3.ts';
import type { CameraOptions } from '../types.ts';
import { clamp, easeInOutCubic, lerp, lerpAngle } from '../util/easing.ts';

const DEG_TO_RAD = Math.PI / 180;

/** Largest pitch away from straight down. Beyond this the horizon fills the view and nothing reads. */
export const MAX_TILT = 80;

/**
 * Floor used in place of the true height above the surface when scaling a zoom step, so a step
 * that lands exactly on the surface (height 0) can still zoom back out afterwards - multiplying
 * zero by any factor leaves it at zero. `zoom.min` defaults well clear of this, so it only matters
 * for a configuration that pushes the minimum altitude close to 1.
 */
const MIN_ZOOM_HEIGHT = 1e-4;

interface Animation {
  from: CameraOptions;
  to: CameraOptions;
  start: number;
  duration: number;
}

export class Camera {
  lat: number;
  lon: number;
  altitude: number;
  tilt: number;
  bearing: number;

  private animation: Animation | null = null;
  private limits: { min: number; max: number };

  constructor(initial: CameraOptions, limits: { min: number; max: number }) {
    this.limits = limits;
    this.lat = clampLat(initial.lat);
    this.lon = normalizeLon(initial.lon);
    this.altitude = clamp(initial.altitude, limits.min, limits.max);
    this.tilt = clamp(initial.tilt, 0, MAX_TILT);
    this.bearing = initial.bearing;
  }

  setLimits(limits: { min: number; max: number }): void {
    this.limits = limits;
    this.altitude = clamp(this.altitude, limits.min, limits.max);
  }

  get state(): CameraOptions {
    return {
      lat: this.lat,
      lon: this.lon,
      altitude: this.altitude,
      tilt: this.tilt,
      bearing: this.bearing,
    };
  }

  /** Apply a partial change immediately, clamping everything into range. */
  apply(changes: Partial<CameraOptions>): void {
    if (changes.lat !== undefined) {
      this.lat = clampLat(changes.lat);
    }
    if (changes.lon !== undefined) {
      this.lon = normalizeLon(changes.lon);
    }
    if (changes.altitude !== undefined) {
      this.altitude = clamp(changes.altitude, this.limits.min, this.limits.max);
    }
    if (changes.tilt !== undefined) {
      this.tilt = clamp(changes.tilt, 0, MAX_TILT);
    }
    if (changes.bearing !== undefined) {
      this.bearing = normalizeLon(changes.bearing);
    }
    this.animation = null;
  }

  /** Start an animated move to a new placement. */
  animateTo(changes: Partial<CameraOptions>, duration: number, now: number): void {
    const target: CameraOptions = {
      lat: clampLat(changes.lat ?? this.lat),
      lon: normalizeLon(changes.lon ?? this.lon),
      altitude: clamp(changes.altitude ?? this.altitude, this.limits.min, this.limits.max),
      tilt: clamp(changes.tilt ?? this.tilt, 0, MAX_TILT),
      bearing: changes.bearing ?? this.bearing,
    };
    this.animation = { from: this.state, to: target, start: now, duration: Math.max(1, duration) };
  }

  get animating(): boolean {
    return this.animation !== null;
  }

  /** Advance any running animation. Returns true while there is still animation left to run. */
  update(now: number): boolean {
    const animation = this.animation;
    if (!animation) {
      return false;
    }

    const linear = clamp((now - animation.start) / animation.duration, 0, 1);
    const t = easeInOutCubic(linear);
    this.lat = lerp(animation.from.lat, animation.to.lat, t);
    this.lon = normalizeLon(lerpAngle(animation.from.lon, animation.to.lon, t));
    this.altitude = lerp(animation.from.altitude, animation.to.altitude, t);
    this.tilt = lerp(animation.from.tilt, animation.to.tilt, t);
    this.bearing = lerpAngle(animation.from.bearing, animation.to.bearing, t);

    if (linear >= 1) {
      this.animation = null;
      return false;
    }
    return true;
  }

  /** Nudge longitude and latitude, used by dragging and by the idle rotation. */
  rotateBy(deltaLon: number, deltaLat: number): void {
    this.lon = normalizeLon(this.lon + deltaLon);
    this.lat = clampLat(this.lat + deltaLat);
    this.animation = null;
  }

  /**
   * Multiply the height above the surface, so zooming feels the same at every distance.
   *
   * `altitude` is measured from the globe's centre, so it is 1 at the surface itself - multiplying
   * *that* directly, as this used to, scales the actual height above the surface (`altitude - 1`)
   * far more aggressively than the factor suggests the closer that height gets to zero, which is
   * exactly backwards from what a zoom control should feel like. A wheel notch that trims a mild
   * ~15% off your height when far out was cutting well over 100% off it near the minimum zoom,
   * which is what made scrolling feel like it kept lurching once zoomed in close. Scaling the
   * height itself instead keeps one notch worth the same relative step at any distance.
   */
  zoomBy(factor: number): void {
    const height = Math.max(this.altitude - 1, MIN_ZOOM_HEIGHT);
    this.altitude = clamp(1 + height * factor, this.limits.min, this.limits.max);
    this.animation = null;
  }

  /** The surface position the camera is looking at. */
  get focus(): Vec3 {
    return lonLatToVec3(this.lon, this.lat, 1);
  }

  /**
   * Eye position and orientation in globe space.
   *
   * With no tilt the eye sits directly above the focus point. Tilting rotates the eye around the
   * focus along the screen vertical, which is the motion people expect from dragging with a modifier
   * held: the globe appears to lean back rather than to spin.
   */
  view(): { eye: Vec3; target: Vec3; up: Vec3 } {
    const focus = this.focus;
    const normal = normalize(focus);

    // North tangent at the focus, degenerating at the poles where any tangent will do.
    const polar = Math.abs(this.lat) > 89.9;
    const northPole: Vec3 = [0, 1, 0];
    const rawNorth = polar
      ? [0, 0, this.lat > 0 ? -1 : 1]
      : sub(northPole, scale(normal, normal[1]));
    const north = normalize(rawNorth as Vec3);

    const up = rotateAroundAxis(north, normal, -this.bearing * DEG_TO_RAD);
    const right = normalize(cross(up, normal));

    const offset = scale(normal, this.altitude - 1);
    const tilted = rotateAroundAxis(offset, right, this.tilt * DEG_TO_RAD);
    const eye: Vec3 = [focus[0] + tilted[0], focus[1] + tilted[1], focus[2] + tilted[2]];
    const tiltedUp = rotateAroundAxis(up, right, this.tilt * DEG_TO_RAD);

    return { eye, target: focus, up: tiltedUp };
  }

  /** Combined view projection matrix for the current placement. */
  viewProjection(aspect: number): { matrix: Mat4; eye: Vec3 } {
    const { eye, target, up } = this.view();
    const distance = Math.hypot(eye[0], eye[1], eye[2]);
    // Keep the depth range tight around the globe so the depth buffer stays precise enough to hide
    // dots and routes on the far side.
    const near = Math.max(0.01, (distance - 1) * 0.1);
    const far = distance + 2;
    const projection = perspective(FIELD_OF_VIEW, aspect, near, far);
    return { matrix: multiply(projection, lookAt(eye, target, up)), eye };
  }

  /**
   * Distance needed to fit a span of the globe's surface inside a given field of view, in globe radii
   * from the centre.
   *
   * Used by `Globe.fitPoints` to work out how far to pull back to frame a set of points: a cap of the
   * given angular span, viewed from this distance, exactly fills that field of view. `fov` defaults to
   * the camera's (vertical) field of view; pass the horizontal one instead to fit a span that runs
   * left-to-right rather than top-to-bottom. `padding` scales the result outward so the points end up
   * inside the frame with some breathing room rather than exactly touching its edge - see
   * `GlobeConfig.fit.padding`.
   */
  static altitudeForSpan(
    spanDegrees: number,
    limits: { min: number; max: number },
    options: { fov?: number; padding?: number } = {},
  ): number {
    const half = Math.max(2, Math.min(170, spanDegrees)) / 2;
    const angle = half * DEG_TO_RAD;
    const required =
      Math.sin(angle) / Math.tan((options.fov ?? FIELD_OF_VIEW) / 2) + Math.cos(angle);
    return clamp(required * (options.padding ?? 1.15), limits.min, limits.max);
  }
}
