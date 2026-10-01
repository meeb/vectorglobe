/**
 * vectorglobe
 *
 * A self-contained vector world map. Bind it to a container element and it renders a 3D globe, or a
 * flat map where WebGL is unavailable, with every country outline embedded in the bundle.
 *
 *   const map = vectorGlobe(document.getElementById('map'), { theme, config });
 *   map.addPoint({ id: 'LHR', lat: 51.47, lon: -0.45, label: 'LHR', title: 'Heathrow' });
 *   map.addRoute({ id: 'LHR-JFK', from: 'LHR', to: 'JFK' });
 */

import { Globe } from './core/globe.ts';
import { WORLD_META } from './data/world.generated.ts';
import type {
  CameraOptions,
  CameraTransition,
  DeepPartial,
  GlobeConfig,
  GlobeEventHandler,
  GlobeEventName,
  Mode,
  PointSpec,
  ResolvedPoint,
  ResolvedRoute,
  RouteSpec,
  Theme,
  VectorGlobeInstance,
  VectorGlobeOptions,
} from './types.ts';

export { DEFAULT_CONFIG, DEFAULT_THEME } from './defaults.ts';
export type {
  CameraOptions,
  CameraTransition,
  DeepPartial,
  GlobeConfig,
  GlobeEventHandler,
  GlobeEventMap,
  GlobeEventName,
  HitTarget,
  Mode,
  ModePreference,
  PointerEventPayload,
  PointSpec,
  Projection,
  ResolvedPoint,
  ResolvedRoute,
  RoutePoint,
  RouteSpec,
  Theme,
  VectorGlobeInstance,
  VectorGlobeOptions,
} from './types.ts';

/** Provenance of the embedded border data, for attribution. */
export const worldData = WORLD_META;

declare const __VECTORGLOBE_VERSION__: string;

/**
 * Library version, replaced at build time with the version from package.json.
 *
 * The guard keeps this working when the source is used directly, such as from the test suite, where
 * nothing has substituted the value in.
 */
export const version =
  typeof __VECTORGLOBE_VERSION__ !== 'undefined' ? __VECTORGLOBE_VERSION__ : 'dev';

/**
 * Create a map and bind it to a container element.
 *
 * The container should have a size of its own; the map fills it and follows it as it resizes.
 */
export function vectorGlobe(
  container: HTMLElement,
  options: VectorGlobeOptions = {},
): VectorGlobeInstance {
  const globe = new Globe(container, options);

  // The public surface is chainable, which the class itself is not: keeping the two apart means the
  // internals never have to return `this` from methods that have nothing to return.
  const instance: VectorGlobeInstance = {
    get mode(): Mode {
      return globe.mode;
    },
    get container(): HTMLElement {
      return globe.container;
    },

    addPoint(point: PointSpec) {
      globe.addPoint(point);
      return instance;
    },
    addPoints(points: PointSpec[]) {
      globe.addPoints(points);
      return instance;
    },
    updatePoint(id: string, changes: Partial<Omit<PointSpec, 'id'>>) {
      globe.updatePoint(id, changes);
      return instance;
    },
    removePoint(id: string) {
      globe.removePoint(id);
      return instance;
    },
    getPoint(id: string): ResolvedPoint | undefined {
      return globe.getPoint(id);
    },
    getPoints(): ResolvedPoint[] {
      return globe.getPoints();
    },
    clearPoints() {
      globe.clearPoints();
      return instance;
    },

    addRoute(route: RouteSpec) {
      globe.addRoute(route);
      return instance;
    },
    addRoutes(routes: RouteSpec[]) {
      globe.addRoutes(routes);
      return instance;
    },
    updateRoute(id: string, changes: Partial<Omit<RouteSpec, 'id'>>) {
      globe.updateRoute(id, changes);
      return instance;
    },
    removeRoute(id: string) {
      globe.removeRoute(id);
      return instance;
    },
    getRoute(id: string): ResolvedRoute | undefined {
      return globe.getRoute(id);
    },
    getRoutes(): ResolvedRoute[] {
      return globe.getRoutes();
    },
    clearRoutes() {
      globe.clearRoutes();
      return instance;
    },

    setTheme(theme: Partial<Theme>) {
      globe.setTheme(theme);
      return instance;
    },
    getTheme(): Theme {
      return globe.getTheme();
    },
    setConfig(config: DeepPartial<GlobeConfig>) {
      globe.setConfig(config);
      return instance;
    },
    getConfig(): GlobeConfig {
      return globe.getConfig();
    },

    setCamera(camera: Partial<CameraOptions>, transition?: CameraTransition) {
      globe.setCamera(camera, transition);
      return instance;
    },
    getCamera(): CameraOptions {
      return globe.getCamera();
    },
    flyTo(target: string | Partial<CameraOptions>, transition?: CameraTransition) {
      globe.flyTo(target, transition);
      return instance;
    },
    fitPoints(ids?: string[], transition?: CameraTransition) {
      globe.fitPoints(ids, transition);
      return instance;
    },
    resetCamera(transition?: CameraTransition) {
      globe.resetCamera(transition);
      return instance;
    },

    on<E extends GlobeEventName>(event: E, handler: GlobeEventHandler<E>) {
      globe.on(event, handler);
      return instance;
    },
    off<E extends GlobeEventName>(event: E, handler: GlobeEventHandler<E>) {
      globe.off(event, handler);
      return instance;
    },

    resize() {
      globe.resize();
      return instance;
    },
    render() {
      globe.render();
      return instance;
    },
    destroy() {
      globe.destroy();
    },
  };

  return instance;
}

/** Default export, so `import vectorGlobe from '@meeby/vectorglobe'` works too. */
export default vectorGlobe;
