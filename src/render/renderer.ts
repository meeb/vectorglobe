/**
 * The contract both renderers implement.
 *
 * The map itself never branches on which renderer is active. It prepares a scene, hands it over, and
 * asks for projections when it needs to place labels or work out what the pointer is over.
 */

import type { Camera } from '../core/camera.ts';
import type { Vec3 } from '../math/vec3.ts';
import type { GlobeConfig, Mode, ResolvedPoint, ResolvedRoute, Theme } from '../types.ts';

/** A route with its curve already sampled into globe space positions. */
export interface PreparedRoute {
  route: ResolvedRoute;
  /** Interleaved x/y/z positions along the curve. */
  positions: Float32Array;
}

/** Everything a renderer needs to draw one frame. */
export interface Scene {
  theme: Theme;
  config: GlobeConfig;
  camera: Camera;
  points: ResolvedPoint[];
  routes: PreparedRoute[];
  /** Container size in CSS pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  /** Bumped when points change, so buffers are only rebuilt when they need to be. */
  pointsRevision: number;
  /** Bumped when routes change. */
  routesRevision: number;
  /** Bumped when the theme or configuration changes. */
  styleRevision: number;
}

/** Where a globe space position lands on screen. */
export interface Projected {
  /** Position in CSS pixels relative to the container. */
  x: number;
  y: number;
  /** False when the position is on the far side of the globe or outside the view. */
  visible: boolean;
}

export interface Renderer {
  readonly mode: Mode;
  readonly canvas: HTMLCanvasElement;
  /** Resize the drawing buffer. Sizes are in CSS pixels. */
  resize(width: number, height: number, pixelRatio: number): void;
  /** Draw a frame. */
  render(scene: Scene): void;
  /** Project a globe space position to container pixels. */
  project(position: Vec3, scene: Scene): Projected;
  /** Find the geographic position under a container pixel, or null if it misses the globe. */
  unproject(x: number, y: number, scene: Scene): [number, number] | null;
  /** Release GPU resources and detach the canvas. */
  destroy(): void;
}

/** Radii at which each layer is drawn, spaced so they stack without fighting for depth. */
export const LAYER_RADIUS = {
  globe: 1,
  land: 1.0005,
  graticule: 1.0012,
  border: 1.0018,
  point: 1.0025,
  /** Routes start here, before any altitude the caller asked for is added. */
  route: 1.003,
} as const;
