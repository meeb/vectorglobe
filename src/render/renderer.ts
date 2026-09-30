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

/**
 * Radii at which each layer is drawn, spaced so they stack without fighting for depth - but as
 * close together as that allows, since every layer above land is a stroke or a dot that is meant to
 * trace the land fill exactly, and any radius gap between them becomes a visible offset between the
 * stroke and the fill under perspective, worst near the horizon at a tilted camera angle. The two
 * concerns pull in opposite directions, so the layers are split into two groups with different rules:
 *
 * - Land and the globe both write to the depth buffer, so their gap has to survive an actual
 *   hardware depth comparison, not just look distinct on paper - 0.0005 measurably did not: small
 *   slivers of the land mesh would lose the depth test to the water sphere beneath them and show as
 *   stray diamond-shaped gaps in the fill, most visible on complex, heavily subdivided coastlines
 *   (verified on Antarctica and Russia against the actual built bundle in a real WebGL context, not
 *   just reasoned about). 0.002 fixed it with headroom.
 * - The graticule, borders, points and routes never write depth (`depthMask(false)`), so they only
 *   ever face a one-sided test against land, not a mutual fight - and that only needs the small gap
 *   this project shipped with before the land/water bug above was ever found, which was never itself
 *   reported as flickering. Pushing them out to a full 0.002 step each, the same as land needed from
 *   water, is what caused the misalignment: borders ended up 0.004 above the fill they outline,
 *   visibly offset from it near the horizon at any real tilt. They keep a tight, fixed step above
 *   land instead, scaled to still clear land at any zoom without following it out further than that.
 */
export const LAYER_RADIUS = {
  globe: 1,
  land: 1.002,
  graticule: 1.0022,
  border: 1.0023,
  point: 1.0025,
  /** Routes start here, before any altitude the caller asked for is added. */
  route: 1.0026,
} as const;
