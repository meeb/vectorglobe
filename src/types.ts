/**
 * Public API types.
 *
 * Everything an application touches is declared here, so this file doubles as the reference for the
 * shape of the options object, the point and route specifications and the event payloads.
 */

/** Which renderer is actually in use. */
export type Mode = '3d' | '2d';

/** Requested renderer. `auto` uses 3D when WebGL is available and falls back to 2D when it is not. */
export type ModePreference = 'auto' | Mode;

/** Projection used by the 2D renderer. */
export type Projection = 'equirectangular' | 'mercator';

/** Every colour in the map. Any CSS colour string is accepted, including rgba() and #rrggbbaa. */
export interface Theme {
  /** Painted behind the globe. `transparent` lets the host page show through. */
  background: string;
  /** Ocean, which in 3D is the globe sphere itself. */
  water: string;
  /** Country fill. */
  land: string;
  /** Borders between two countries. */
  border: string;
  /** Coastlines, meaning any border not shared with another country. */
  coastline: string;
  /** Latitude and longitude grid, when enabled. */
  graticule: string;
  /** Atmospheric rim light around the globe, 3D only. */
  atmosphere: string;
  /** Default dot colour, overridable per point. */
  point: string;
  /** Default dot label text colour. */
  pointLabel: string;
  /** Backing behind label text, keeping it readable over land or water. */
  pointLabelBackground: string;
  /** Default route colour, overridable per route. */
  route: string;
}

/** Camera placement. In 2D, `lat`/`lon` are the centre of the view and `tilt`/`bearing` are ignored. */
export interface CameraOptions {
  /** Latitude the camera looks at, in degrees. */
  lat: number;
  /** Longitude the camera looks at, in degrees. */
  lon: number;
  /** Distance from the centre of the globe in globe radii, so 1 is ground level. */
  altitude: number;
  /** Pitch away from looking straight down, in degrees, 0 to 80. */
  tilt: number;
  /** Rotation of the view around the local vertical, in degrees. */
  bearing: number;
}

/** Options accepted when animating the camera. */
export interface CameraTransition {
  /** Animate instead of jumping. Ignored when the user prefers reduced motion. */
  animate?: boolean;
  /** Animation length in milliseconds. */
  duration?: number;
}

/** Behavioural configuration. Every field has a default, see `defaults.ts`. */
export interface GlobeConfig {
  /** Renderer preference. */
  mode: ModePreference;
  /** Starting camera placement. */
  camera: CameraOptions;
  /** Altitude limits for zooming, in globe radii from the centre. */
  zoom: { min: number; max: number };
  /** Whether pointer, touch and keyboard interaction is enabled at all. */
  interactive: boolean;
  /** Idle rotation. */
  autoRotate: {
    enabled: boolean;
    /** Degrees of longitude per second. */
    speed: number;
    /** Stop rotating once the user interacts. */
    pauseOnInteract: boolean;
    /** Milliseconds of inactivity before rotation resumes, when it is not paused permanently. */
    resumeAfter: number;
  };
  /** Latitude and longitude grid. */
  graticule: { enabled: boolean; step: number; width: number };
  /** Atmospheric rim light, 3D only. */
  atmosphere: { enabled: boolean; strength: number };
  /** Dot labels. */
  labels: {
    enabled: boolean;
    /** Hide labels that would overlap one already drawn. */
    collide: boolean;
    /** Gap in pixels between the dot and its label. */
    offset: number;
  };
  /** Country outlines. */
  borders: { enabled: boolean; width: number };
  /** Country fill. */
  land: { enabled: boolean };
  /** Defaults applied to routes that do not override them. */
  routes: {
    /** Samples used per curve. More is smoother and slower. */
    segments: number;
    /** Apex height of a generated arc as a fraction of the globe radius, scaled by route length. */
    arcHeight: number;
    width: number;
  };
  /** Defaults applied to points that do not override them. */
  points: { size: number };
  /** Projection used by the 2D renderer. */
  projection: Projection;
  /** Device pixel ratio, or `auto` to follow the display, capped at 2 for performance. */
  pixelRatio: number | 'auto';
  /** Multisampling in the WebGL context. */
  antialias: boolean;
  /** Longitude divisions of the globe sphere. Higher is rounder and slightly slower. */
  sphereSegments: number;
  /**
   * How much the globe darkens towards its edge, from 0 for a flat disc to 1 for a heavy vignette.
   *
   * The default suits a dark palette. A light one usually wants much less, since the same shading
   * reads as a dirty ring around the edge rather than as depth.
   */
  shading: number;
}

/** A labelled dot, such as an airport. */
export interface PointSpec {
  /** Unique identifier, also used to reference the point from a route. */
  id: string;
  lat: number;
  lon: number;
  /** Short tag rendered next to the dot, for example an airport code. */
  label?: string;
  /** Longer name, rendered under the tag. */
  title?: string;
  /** Overrides `theme.point`. */
  color?: string;
  /** Radius in pixels. */
  size?: number;
  /** 0 to 1. */
  opacity?: number;
  /** Set false to draw the dot without its label. */
  labelVisible?: boolean;
  /** Anything the application wants to carry along; returned in event payloads. */
  data?: unknown;
}

/** A point on a route path: longitude, latitude and an optional altitude in kilometres. */
export type RoutePoint = [number, number] | [number, number, number];

/**
 * A connection between two places.
 *
 * Either give `from` and `to` as point ids and let the map generate a great circle arc between them,
 * or give an explicit `path` of coordinates to follow.
 */
export interface RouteSpec {
  /** Unique identifier. */
  id: string;
  /** Id of the point the route starts at. Used with `to`, ignored when `path` is given. */
  from?: string;
  /** Id of the point the route ends at. */
  to?: string;
  /** Explicit route geometry. Altitude is in kilometres above sea level and is ignored in 2D. */
  path?: RoutePoint[];
  /** How an explicit path is interpolated. `smooth` fits a curve through every given point. */
  curve?: 'smooth' | 'linear';
  /** Overrides `theme.route`. */
  color?: string;
  /** Line width in pixels. */
  width?: number;
  /** 0 to 1. */
  opacity?: number;
  /** Apex height of a generated arc as a fraction of the globe radius. */
  arcHeight?: number;
  /** Samples used for this curve, overriding `config.routes.segments`. */
  segments?: number;
  /** Anything the application wants to carry along; returned in event payloads. */
  data?: unknown;
}

/** A point with every default resolved. */
export interface ResolvedPoint extends PointSpec {
  color: string;
  size: number;
  opacity: number;
  labelVisible: boolean;
}

/** A route with every default resolved. */
export interface ResolvedRoute extends RouteSpec {
  color: string;
  width: number;
  opacity: number;
}

/** What the pointer is over, if anything. */
export interface HitTarget {
  kind: 'point' | 'route';
  id: string;
  point?: ResolvedPoint;
  route?: ResolvedRoute;
}

/** Payload of a pointer event. */
export interface PointerEventPayload {
  /** The point or route under the pointer, or null for empty space. */
  target: HitTarget | null;
  /** Geographic position under the pointer, or null when the pointer is off the globe. */
  lat: number | null;
  lon: number | null;
  /** The DOM event that triggered this. */
  originalEvent: MouseEvent;
}

/** Event names and the payload each one delivers. */
export interface GlobeEventMap {
  ready: { mode: Mode };
  click: PointerEventPayload;
  hover: PointerEventPayload;
  camerachange: { camera: CameraOptions };
  modechange: { mode: Mode; reason: string };
  error: { error: Error };
}

export type GlobeEventName = keyof GlobeEventMap;

export type GlobeEventHandler<E extends GlobeEventName> = (payload: GlobeEventMap[E]) => void;

/** Recursively optional, used so callers can override a single nested field. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Options passed when binding the map to a container. */
export interface VectorGlobeOptions {
  theme?: Partial<Theme>;
  config?: DeepPartial<GlobeConfig>;
  /** Points to add immediately, equivalent to calling addPoints() after construction. */
  points?: PointSpec[];
  /** Routes to add immediately. */
  routes?: RouteSpec[];
}

/** The map instance returned by `vectorGlobe()`. */
export interface VectorGlobeInstance {
  /** Which renderer ended up being used. */
  readonly mode: Mode;
  /** The container the map is bound to. */
  readonly container: HTMLElement;

  addPoint(point: PointSpec): VectorGlobeInstance;
  addPoints(points: PointSpec[]): VectorGlobeInstance;
  updatePoint(id: string, changes: Partial<Omit<PointSpec, 'id'>>): VectorGlobeInstance;
  removePoint(id: string): VectorGlobeInstance;
  getPoint(id: string): ResolvedPoint | undefined;
  getPoints(): ResolvedPoint[];
  clearPoints(): VectorGlobeInstance;

  addRoute(route: RouteSpec): VectorGlobeInstance;
  addRoutes(routes: RouteSpec[]): VectorGlobeInstance;
  updateRoute(id: string, changes: Partial<Omit<RouteSpec, 'id'>>): VectorGlobeInstance;
  removeRoute(id: string): VectorGlobeInstance;
  getRoute(id: string): ResolvedRoute | undefined;
  getRoutes(): ResolvedRoute[];
  clearRoutes(): VectorGlobeInstance;

  setTheme(theme: Partial<Theme>): VectorGlobeInstance;
  getTheme(): Theme;
  setConfig(config: DeepPartial<GlobeConfig>): VectorGlobeInstance;
  getConfig(): GlobeConfig;

  setCamera(camera: Partial<CameraOptions>, transition?: CameraTransition): VectorGlobeInstance;
  getCamera(): CameraOptions;
  /** Centre on a point id or an explicit position. */
  flyTo(
    target: string | Partial<CameraOptions>,
    transition?: CameraTransition,
  ): VectorGlobeInstance;
  /** Frame the given point ids, or every point when omitted. */
  fitPoints(ids?: string[], transition?: CameraTransition): VectorGlobeInstance;

  on<E extends GlobeEventName>(event: E, handler: GlobeEventHandler<E>): VectorGlobeInstance;
  off<E extends GlobeEventName>(event: E, handler: GlobeEventHandler<E>): VectorGlobeInstance;

  /** Re-read the container size. Called automatically when the container resizes. */
  resize(): VectorGlobeInstance;
  /** Request a redraw. Rendering is on demand, so this is only needed after external changes. */
  render(): VectorGlobeInstance;
  /** Tear down listeners, DOM and GPU resources. */
  destroy(): void;
}
