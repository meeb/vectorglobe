/**
 * The map itself.
 *
 * Owns the DOM, the renderer, the camera and the scene, and is the only place that knows how all of
 * them fit together. The public API in `index.ts` is a thin wrapper over this class.
 *
 * Frames are drawn on demand. Anything that changes what is on screen marks the map dirty and asks
 * for one frame; continuous animation only runs while the camera is moving or the globe is spinning,
 * so an idle map costs nothing.
 */

import { DEFAULT_CONFIG, DEFAULT_THEME, FIELD_OF_VIEW } from '../defaults.ts';
import { greatCircleArc, linearPath, smoothPath } from '../math/curves.ts';
import { boundsOf, kmToRadius, lonLatToVec3 } from '../math/geo.ts';
import type { Vec3 } from '../math/vec3.ts';
import { LabelLayer } from '../overlay/labels.ts';
import { injectStyles } from '../overlay/styles.ts';
import { CanvasRenderer } from '../render/canvas2d/canvas-renderer.ts';
import { LAYER_RADIUS, type PreparedRoute, type Renderer, type Scene } from '../render/renderer.ts';
import { WebGLRenderer } from '../render/webgl/webgl-renderer.ts';
import type {
  CameraOptions,
  CameraTransition,
  DeepPartial,
  GlobeConfig,
  GlobeEventHandler,
  GlobeEventName,
  HitTarget,
  Mode,
  PointSpec,
  ResolvedPoint,
  ResolvedRoute,
  RouteSpec,
  Theme,
  VectorGlobeOptions,
} from '../types.ts';
import { deepMerge } from '../util/merge.ts';
import { Camera } from './camera.ts';
import { detectCapabilities } from './capabilities.ts';
import { Controls, type ControlsDelegate } from './controls.ts';
import { Emitter } from './events.ts';
import { resolvePoint, resolveRoute, SceneState } from './state.ts';

/** How close the pointer has to be, in pixels, to count as being over a dot or a route. */
const HIT_TOLERANCE = 6;

/** Degrees of tilt or bearing applied per pixel of a tilt drag. */
const TILT_PER_PIXEL = 0.25;

/** Default length of a camera animation, in milliseconds. */
const DEFAULT_TRANSITION = 800;

/**
 * Longest frame delta fed to time based animation, in milliseconds.
 *
 * Frames are only drawn when something changes, so the gap since the previous frame can be minutes.
 * Without a ceiling the first frame after an idle period would advance the idle rotation by that
 * whole gap and the globe would jump.
 */
const MAX_FRAME_DELTA = 100;

export class Globe {
  readonly container: HTMLElement;

  private theme: Theme;
  private config: GlobeConfig;
  private state = new SceneState();
  private camera: Camera;
  private emitter = new Emitter();
  private renderer: Renderer;
  private labels: LabelLayer;
  private controls: Controls;

  private root: HTMLElement;
  private document: Document;
  private resizeObserver: ResizeObserver | null = null;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private styleRevision = 0;
  private preparedRoutes: PreparedRoute[] = [];
  private preparedRoutesRevision = -1;
  private preparedStyleRevision = -1;

  private frameHandle: number | null = null;
  private dirty = true;
  private destroyed = false;
  private lastFrameTime = 0;
  private lastInteraction = 0;
  private autoRotateStopped = false;
  private hovered: string | null = null;
  private reducedMotion = false;

  constructor(container: HTMLElement, options: VectorGlobeOptions = {}) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('vectorglobe: a container element is required');
    }

    this.container = container;
    this.document = container.ownerDocument;
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.config = deepMerge(DEFAULT_CONFIG, options.config);

    const capabilities = detectCapabilities(this.config.pixelRatio);
    this.pixelRatio = capabilities.pixelRatio;
    this.reducedMotion = capabilities.reducedMotion;

    injectStyles(this.document);
    this.root = this.document.createElement('div');
    this.root.className = 'vg-root';
    container.appendChild(this.root);

    this.camera = new Camera(this.config.camera, this.config.zoom);
    this.renderer = this.createRenderer(capabilities.webgl);
    this.root.appendChild(this.renderer.canvas);

    this.labels = new LabelLayer(this.document);
    this.root.appendChild(this.labels.element);

    this.applyThemeVariables();
    this.controls = new Controls(
      this.root,
      this.controlsDelegate(),
      this.config.interactive,
      this.config.zoom.speed,
    );
    this.observeResize();
    this.measure();

    if (options.points) {
      this.addPoints(options.points);
    }
    if (options.routes) {
      this.addRoutes(options.routes);
    }

    this.watchContextLoss();
    this.requestFrame();
    // Deferred so a handler attached straight after construction still sees the event.
    queueMicrotask(() => {
      if (!this.destroyed) {
        this.emitter.emit('ready', { mode: this.renderer.mode });
      }
    });
  }

  get mode(): Mode {
    return this.renderer.mode;
  }

  // Scene contents ------------------------------------------------------------------------------

  addPoint(point: PointSpec): void {
    this.state.addPoint(point);
    this.invalidate();
  }

  addPoints(points: PointSpec[]): void {
    for (const point of points) {
      this.state.addPoint(point);
    }
    this.invalidate();
  }

  updatePoint(id: string, changes: Partial<Omit<PointSpec, 'id'>>): void {
    this.state.updatePoint(id, changes);
    this.invalidate();
  }

  removePoint(id: string): void {
    this.state.removePoint(id);
    this.invalidate();
  }

  getPoint(id: string): ResolvedPoint | undefined {
    const spec = this.state.rawPoint(id);
    return spec ? resolvePoint(spec, this.theme, this.config) : undefined;
  }

  getPoints(): ResolvedPoint[] {
    return this.state.rawPoints().map((spec) => resolvePoint(spec, this.theme, this.config));
  }

  clearPoints(): void {
    this.state.clearPoints();
    this.invalidate();
  }

  addRoute(route: RouteSpec): void {
    this.state.addRoute(route);
    this.invalidate();
  }

  addRoutes(routes: RouteSpec[]): void {
    for (const route of routes) {
      this.state.addRoute(route);
    }
    this.invalidate();
  }

  updateRoute(id: string, changes: Partial<Omit<RouteSpec, 'id'>>): void {
    this.state.updateRoute(id, changes);
    this.invalidate();
  }

  removeRoute(id: string): void {
    this.state.removeRoute(id);
    this.invalidate();
  }

  getRoute(id: string): ResolvedRoute | undefined {
    const spec = this.state.rawRoute(id);
    return spec ? resolveRoute(spec, this.theme, this.config) : undefined;
  }

  getRoutes(): ResolvedRoute[] {
    return this.state.rawRoutes().map((spec) => resolveRoute(spec, this.theme, this.config));
  }

  clearRoutes(): void {
    this.state.clearRoutes();
    this.invalidate();
  }

  // Styling -------------------------------------------------------------------------------------

  setTheme(theme: Partial<Theme>): void {
    this.theme = { ...this.theme, ...theme };
    this.styleRevision++;
    this.applyThemeVariables();
    this.invalidate();
  }

  getTheme(): Theme {
    return { ...this.theme };
  }

  setConfig(config: DeepPartial<GlobeConfig>): void {
    const previousMode = this.config.mode;
    this.config = deepMerge(this.config, config);
    this.styleRevision++;

    this.camera.setLimits(this.config.zoom);
    this.controls.setZoomSpeed(this.config.zoom.speed);
    this.controls.setEnabled(this.config.interactive);
    if (config.autoRotate?.enabled) {
      // Turning rotation on is a deliberate instruction, so it overrides an earlier interaction
      // having paused it; otherwise enabling it could appear to do nothing at all.
      this.autoRotateStopped = false;
      this.lastFrameTime = 0;
    }
    if (config.camera) {
      this.camera.apply(config.camera as Partial<CameraOptions>);
    }
    if (config.pixelRatio !== undefined) {
      this.pixelRatio = detectCapabilities(this.config.pixelRatio).pixelRatio;
      this.measure();
    }
    if (config.mode !== undefined && config.mode !== previousMode) {
      this.switchRenderer('configuration changed');
    }
    this.invalidate();
  }

  getConfig(): GlobeConfig {
    return cloneConfig(this.config);
  }

  // Camera --------------------------------------------------------------------------------------

  setCamera(camera: Partial<CameraOptions>, transition?: CameraTransition): void {
    if (transition?.animate && !this.reducedMotion) {
      this.camera.animateTo(camera, transition.duration ?? DEFAULT_TRANSITION, now());
      this.requestFrame();
    } else {
      this.camera.apply(camera);
      this.invalidate();
    }
    this.emitter.emit('camerachange', { camera: this.camera.state });
  }

  getCamera(): CameraOptions {
    return this.camera.state;
  }

  flyTo(target: string | Partial<CameraOptions>, transition?: CameraTransition): void {
    let destination: Partial<CameraOptions>;
    if (typeof target === 'string') {
      const point = this.state.rawPoint(target);
      if (!point) {
        throw new Error(`vectorglobe: no point with id "${target}" to fly to`);
      }
      destination = { lat: point.lat, lon: point.lon };
    } else {
      destination = target;
    }
    this.setCamera(destination, { animate: true, ...transition });
  }

  fitPoints(ids?: string[], transition?: CameraTransition): void {
    const points = (ids ? ids.map((id) => this.state.rawPoint(id)) : this.state.rawPoints()).filter(
      (point): point is PointSpec => Boolean(point),
    );
    const bounds = boundsOf(points);
    if (!bounds) {
      return;
    }

    const span = Math.max(bounds.spanLat, bounds.spanLon, 5);
    this.setCamera(
      {
        lat: bounds.centerLat,
        lon: bounds.centerLon,
        altitude: Camera.altitudeForSpan(span, this.config.zoom),
      },
      { animate: true, ...transition },
    );
  }

  // Events --------------------------------------------------------------------------------------

  on<E extends GlobeEventName>(event: E, handler: GlobeEventHandler<E>): void {
    this.emitter.on(event, handler);
  }

  off<E extends GlobeEventName>(event: E, handler: GlobeEventHandler<E>): void {
    this.emitter.off(event, handler);
  }

  // Lifecycle -----------------------------------------------------------------------------------

  resize(): void {
    this.measure();
    this.invalidate();
  }

  render(): void {
    this.invalidate();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
    }
    this.resizeObserver?.disconnect();
    this.controls.destroy();
    this.labels.destroy();
    this.renderer.destroy();
    this.emitter.clear();
    this.root.remove();
  }

  // Internals -----------------------------------------------------------------------------------

  private createRenderer(webglAvailable: boolean): Renderer {
    const canvas = this.document.createElement('canvas');
    const wants3D = this.config.mode === '3d' || (this.config.mode === 'auto' && webglAvailable);

    if (wants3D) {
      try {
        return new WebGLRenderer(canvas, this.config.antialias);
      } catch (error) {
        // Asking for 3D explicitly and not getting it is worth reporting, but never worth failing
        // over: a flat map is far better than no map.
        this.emitter.emit('error', { error: error as Error });
      }
    }
    return new CanvasRenderer(canvas);
  }

  /** Swap renderers, keeping the camera and everything that has been added to the map. */
  private switchRenderer(reason: string): void {
    const capabilities = detectCapabilities(this.config.pixelRatio);
    const previous = this.renderer;
    const replacement = this.createRenderer(capabilities.webgl);
    if (replacement.mode === previous.mode) {
      replacement.destroy();
      return;
    }

    previous.destroy();
    this.renderer = replacement;
    this.root.insertBefore(replacement.canvas, this.labels.element);
    this.preparedRoutesRevision = -1;
    this.measure();
    this.invalidate();
    this.emitter.emit('modechange', { mode: replacement.mode, reason });
  }

  /** Fall back to the 2D renderer if the GPU drops the context out from under us. */
  private watchContextLoss(): void {
    this.renderer.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      if (this.renderer.mode === '3d') {
        this.config = { ...this.config, mode: '2d' };
        this.switchRenderer('the WebGL context was lost');
      }
    });
  }

  private controlsDelegate(): ControlsDelegate {
    return {
      rotate: (deltaX, deltaY) => {
        const [lonPerPixel, latPerPixel] = this.dragScale();
        this.camera.rotateBy(-deltaX * lonPerPixel, deltaY * latPerPixel);
        this.afterCameraInput();
      },
      tilt: (deltaX, deltaY) => {
        this.camera.apply({
          tilt: this.camera.tilt + deltaY * TILT_PER_PIXEL,
          bearing: this.camera.bearing + deltaX * TILT_PER_PIXEL,
        });
        this.afterCameraInput();
      },
      zoom: (factor) => {
        this.camera.zoomBy(factor);
        this.afterCameraInput();
      },
      pointerMove: (x, y, event) => this.dispatchPointer('hover', x, y, event),
      pointerLeave: () => {
        if (this.hovered !== null) {
          this.hovered = null;
          this.root.style.cursor = this.config.interactive ? 'grab' : '';
        }
      },
      click: (x, y, event) => this.dispatchPointer('click', x, y, event),
      interact: () => {
        this.lastInteraction = now();
        if (this.config.autoRotate.pauseOnInteract) {
          this.autoRotateStopped = true;
        }
      },
    };
  }

  private afterCameraInput(): void {
    this.invalidate();
    this.emitter.emit('camerachange', { camera: this.camera.state });
  }

  /**
   * Degrees of longitude and latitude covered by one pixel of drag at the current zoom.
   *
   * The target feel is direct manipulation: the point under the cursor at the start of a drag
   * should stay under the cursor, the way grabbing a real globe would. With no tilt, the eye looks
   * straight at the nearest surface point from a distance of `altitude - 1` (altitude is measured
   * from the globe's centre, so 1 is ground level); a small rotation moves that point across the
   * sphere's tangent plane by an arc length equal to the rotation itself (in radians, on a unit
   * sphere), and standard perspective projection turns a sideways offset at distance `d` into
   * roughly `offset / d` radians of apparent angle, which spans `screenHeight / (2 tan(fovY/2))`
   * pixels per radian. Solving that chain for "radians of rotation per pixel of drag" gives the
   * formula below. It does not depend on width despite covering longitude too: for an ordinary
   * (non-anamorphic) perspective camera the horizontal and vertical pixels-per-radian figures are
   * always equal, since aspect ratio is exactly the ratio of the two field of view tangents.
   *
   * This used to instead be based on the angular size of the *globe itself* as seen from the eye,
   * which is a different, unrelated quantity - it happened to keep pace reasonably well zoomed
   * out, but at close zoom it made a drag of a few percent of the window width sweep the entire
   * visible area many times over.
   */
  private dragScale(): [number, number] {
    if (this.renderer.mode === '2d') {
      // One world spans the container width at the reference altitude, scaled by the zoom.
      const zoom = 1.5 / Math.max(0.05, this.camera.altitude - 1);
      const degreesPerPixel = 360 / (this.width * zoom);
      return [degreesPerPixel, degreesPerPixel];
    }

    const height = Math.max(this.camera.altitude - 1, 0.01);
    const radiansPerPixel = (height * 2 * Math.tan(FIELD_OF_VIEW / 2)) / Math.max(1, this.height);
    const degreesPerPixel = radiansPerPixel * (180 / Math.PI);
    return [degreesPerPixel, degreesPerPixel];
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.measure();
      this.invalidate();
    });
    this.resizeObserver.observe(this.container);
  }

  private measure(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width || this.container.clientWidth || 1));
    this.height = Math.max(1, Math.round(rect.height || this.container.clientHeight || 1));
    this.renderer.resize(this.width, this.height, this.pixelRatio);
  }

  private applyThemeVariables(): void {
    this.root.style.setProperty('--vg-point', this.theme.point);
    this.root.style.setProperty('--vg-label', this.theme.pointLabel);
    this.root.style.setProperty('--vg-label-background', this.theme.pointLabelBackground);
  }

  private invalidate(): void {
    this.dirty = true;
    this.requestFrame();
  }

  private requestFrame(): void {
    if (this.destroyed || this.frameHandle !== null) {
      return;
    }
    this.frameHandle = requestAnimationFrame((time) => {
      this.frameHandle = null;
      this.frame(time);
    });
  }

  private frame(time: number): void {
    if (this.destroyed) {
      return;
    }

    const elapsed =
      this.lastFrameTime === 0 ? 0 : Math.min(MAX_FRAME_DELTA, time - this.lastFrameTime);
    this.lastFrameTime = time;

    const cameraMoved = this.camera.update(time);
    const rotated = this.applyAutoRotate(elapsed, time);

    if (this.dirty || cameraMoved || rotated) {
      this.dirty = false;
      const scene = this.buildScene();
      this.renderer.render(scene);
      this.labels.update(scene, this.renderer);
    }

    // Keeping the loop alive is a separate question from whether anything changed. Idle rotation has
    // to keep ticking even on a frame it did not move the camera: the very first frame has no
    // previous timestamp to measure against, and a rotation paused by interaction needs frames in
    // order to notice that it is time to resume.
    if (cameraMoved || this.autoRotateTicking()) {
      this.requestFrame();
    }
  }

  /** Whether idle rotation is switched on, regardless of whether it is currently paused. */
  private autoRotateTicking(): boolean {
    return this.config.autoRotate.enabled && !this.reducedMotion && !this.destroyed;
  }

  /** Advance the idle rotation. Returns true only when it actually moved the camera. */
  private applyAutoRotate(elapsed: number, time: number): boolean {
    const rotate = this.config.autoRotate;
    if (!this.autoRotateTicking()) {
      return false;
    }
    if (this.autoRotateStopped) {
      if (
        rotate.pauseOnInteract &&
        rotate.resumeAfter > 0 &&
        time - this.lastInteraction > rotate.resumeAfter
      ) {
        this.autoRotateStopped = false;
      } else {
        return false;
      }
    }
    // A camera animation owns the camera while it runs, and an explicit move should not fight the
    // idle spin.
    if (this.camera.animating || elapsed <= 0) {
      return false;
    }

    this.camera.rotateBy((rotate.speed * elapsed) / 1000, 0);
    return true;
  }

  private buildScene(): Scene {
    return {
      theme: this.theme,
      config: this.config,
      camera: this.camera,
      points: this.getPoints(),
      routes: this.prepareRoutes(),
      width: this.width,
      height: this.height,
      pixelRatio: this.pixelRatio,
      pointsRevision: this.state.pointsRevision,
      routesRevision: this.state.routesRevision,
      styleRevision: this.styleRevision,
    };
  }

  /**
   * Turn route specifications into sampled curves.
   *
   * Cached against the scene revision, so panning and zooming never re-sample a curve; only adding,
   * changing or removing a route does.
   */
  private prepareRoutes(): PreparedRoute[] {
    if (
      this.preparedRoutesRevision === this.state.routesRevision &&
      this.preparedStyleRevision === this.styleRevision
    ) {
      return this.preparedRoutes;
    }

    const prepared: PreparedRoute[] = [];
    for (const spec of this.state.rawRoutes()) {
      const route = resolveRoute(spec, this.theme, this.config);
      const segments = spec.segments ?? this.config.routes.segments;

      if (spec.path && spec.path.length >= 2) {
        const positions: Vec3[] = spec.path.map((point) => {
          const altitude = point.length > 2 ? (point[2] as number) : 0;
          // Altitudes are kilometres above sea level, lifted clear of the surface layers.
          const radius = kmToRadius(altitude) + (LAYER_RADIUS.route - 1);
          return lonLatToVec3(point[0], point[1], radius);
        });
        const perSpan = Math.max(1, Math.round(segments / Math.max(1, positions.length - 1)));
        prepared.push({
          route,
          positions:
            spec.curve === 'linear'
              ? linearPath(positions, perSpan)
              : smoothPath(positions, perSpan),
        });
        continue;
      }

      const from = spec.from ? this.state.rawPoint(spec.from) : undefined;
      const to = spec.to ? this.state.rawPoint(spec.to) : undefined;
      if (!from || !to) {
        // A route can be added before the points it joins; it simply does not draw until they exist.
        continue;
      }

      prepared.push({
        route,
        positions: greatCircleArc(
          lonLatToVec3(from.lon, from.lat, LAYER_RADIUS.route),
          lonLatToVec3(to.lon, to.lat, LAYER_RADIUS.route),
          segments,
          spec.arcHeight ?? this.config.routes.arcHeight,
        ),
      });
    }

    this.preparedRoutes = prepared;
    this.preparedRoutesRevision = this.state.routesRevision;
    this.preparedStyleRevision = this.styleRevision;
    return prepared;
  }

  /** Work out what is under the pointer and emit the matching event. */
  private dispatchPointer(kind: 'click' | 'hover', x: number, y: number, event: MouseEvent): void {
    const scene = this.buildScene();
    const target = this.hitTest(x, y, scene);
    const position = this.renderer.unproject(x, y, scene);

    if (kind === 'hover') {
      const id = target?.id ?? null;
      if (id === this.hovered) {
        return;
      }
      this.hovered = id;
      this.root.style.cursor = target ? 'pointer' : this.config.interactive ? 'grab' : '';
    }

    this.emitter.emit(kind, {
      target,
      lat: position ? position[1] : null,
      lon: position ? position[0] : null,
      originalEvent: event,
    });
  }

  private hitTest(x: number, y: number, scene: Scene): HitTarget | null {
    let best: { target: HitTarget; distance: number } | null = null;

    for (const point of scene.points) {
      const projected = this.renderer.project(
        lonLatToVec3(point.lon, point.lat, LAYER_RADIUS.point),
        scene,
      );
      if (!projected.visible) {
        continue;
      }
      const distance = Math.hypot(projected.x - x, projected.y - y);
      if (distance <= point.size + HIT_TOLERANCE && (!best || distance < best.distance)) {
        best = { target: { kind: 'point', id: point.id, point }, distance };
      }
    }

    if (best) {
      return best.target;
    }

    for (const prepared of scene.routes) {
      const positions = prepared.positions;
      for (let i = 0; i < positions.length; i += 3) {
        const projected = this.renderer.project(
          [positions[i], positions[i + 1], positions[i + 2]],
          scene,
        );
        if (!projected.visible) {
          continue;
        }
        const distance = Math.hypot(projected.x - x, projected.y - y);
        const tolerance = prepared.route.width + HIT_TOLERANCE;
        if (distance <= tolerance && (!best || distance < best.distance)) {
          best = {
            target: { kind: 'route', id: prepared.route.id, route: prepared.route },
            distance,
          };
        }
      }
    }

    return best?.target ?? null;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** A plain deep copy of the configuration, so callers cannot mutate the map's own state. */
function cloneConfig(config: GlobeConfig): GlobeConfig {
  return {
    ...config,
    camera: { ...config.camera },
    zoom: { ...config.zoom },
    autoRotate: { ...config.autoRotate },
    graticule: { ...config.graticule },
    atmosphere: { ...config.atmosphere },
    labels: { ...config.labels },
    borders: { ...config.borders },
    land: { ...config.land },
    routes: { ...config.routes },
    points: { ...config.points },
  };
}
