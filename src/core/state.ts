/**
 * The scene: what has been added to the map.
 *
 * Specifications are stored exactly as the caller gave them and only resolved against the current
 * theme and configuration on demand, so changing the theme restyles everything without the caller
 * having to re-add anything.
 *
 * A revision counter is bumped on every change. Renderers compare it against the revision they last
 * built geometry for, which is what keeps redraws free when nothing has actually changed.
 */

import type {
  Fade,
  GlobeConfig,
  PointSpec,
  ResolvedPoint,
  ResolvedRoute,
  RouteSpec,
  Theme,
} from '../types.ts';
import { now } from '../util/time.ts';

interface FadeRecord {
  /** When the fade began, same clock as `now()`. */
  start: number;
  /** Fires removal once the fade has fully run out; always cleared before it fires again. */
  timer: ReturnType<typeof setTimeout>;
}

export class SceneState {
  private points = new Map<string, PointSpec>();
  private routes = new Map<string, RouteSpec>();
  private pointFades = new Map<string, FadeRecord>();
  private routeFades = new Map<string, FadeRecord>();
  /**
   * Called whenever a fade finishes and removes its point or route on its own, outside of any
   * caller-initiated change - the one case a revision bump happens without a matching public method
   * call, so the map needs telling to draw the result rather than noticing on its own.
   */
  private readonly onFadeExpire?: () => void;

  /** Bumped whenever the set of points changes in a way that needs new geometry. */
  pointsRevision = 0;
  /** Bumped whenever the set of routes changes. */
  routesRevision = 0;

  constructor(onFadeExpire?: () => void) {
    this.onFadeExpire = onFadeExpire;
  }

  addPoint(spec: PointSpec): void {
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) {
      throw new Error('vectorglobe: a point needs a non-empty string id');
    }
    if (!Number.isFinite(spec.lat) || !Number.isFinite(spec.lon)) {
      throw new Error(`vectorglobe: point "${spec.id}" needs finite lat and lon values`);
    }
    const previous = this.points.get(spec.id);
    this.points.set(spec.id, { ...spec });
    this.pointsRevision++;
    // A route may be anchored to this point, so its geometry has to be rebuilt too.
    this.routesRevision++;
    this.scheduleFade(this.pointFades, spec.id, previous?.fade, spec.fade, () =>
      this.removePoint(spec.id),
    );
  }

  updatePoint(id: string, changes: Partial<Omit<PointSpec, 'id'>>): void {
    const existing = this.points.get(id);
    if (!existing) {
      throw new Error(`vectorglobe: no point with id "${id}"`);
    }
    this.addPoint({ ...existing, ...changes, id });
  }

  removePoint(id: string): void {
    this.endFade(this.pointFades, id);
    if (this.points.delete(id)) {
      this.pointsRevision++;
      this.routesRevision++;
    }
  }

  clearPoints(): void {
    if (this.points.size > 0) {
      this.points.clear();
      this.pointsRevision++;
      this.routesRevision++;
    }
    this.clearFades(this.pointFades);
  }

  rawPoint(id: string): PointSpec | undefined {
    return this.points.get(id);
  }

  rawPoints(): PointSpec[] {
    return Array.from(this.points.values());
  }

  get pointCount(): number {
    return this.points.size;
  }

  /** When this point's fade began, same clock as `now()` - `undefined` without one in progress. */
  pointFadeStart(id: string): number | undefined {
    return this.pointFades.get(id)?.start;
  }

  addRoute(spec: RouteSpec): void {
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) {
      throw new Error('vectorglobe: a route needs a non-empty string id');
    }
    const hasEndpoints = typeof spec.from === 'string' && typeof spec.to === 'string';
    const hasPath = Array.isArray(spec.path) && spec.path.length >= 2;
    if (!hasEndpoints && !hasPath) {
      throw new Error(
        `vectorglobe: route "${spec.id}" needs either from and to point ids, or a path of at least two coordinates`,
      );
    }
    const previous = this.routes.get(spec.id);
    this.routes.set(spec.id, { ...spec });
    this.routesRevision++;
    this.scheduleFade(this.routeFades, spec.id, previous?.fade, spec.fade, () =>
      this.removeRoute(spec.id),
    );
  }

  updateRoute(id: string, changes: Partial<Omit<RouteSpec, 'id'>>): void {
    const existing = this.routes.get(id);
    if (!existing) {
      throw new Error(`vectorglobe: no route with id "${id}"`);
    }
    this.addRoute({ ...existing, ...changes, id });
  }

  removeRoute(id: string): void {
    this.endFade(this.routeFades, id);
    if (this.routes.delete(id)) {
      this.routesRevision++;
    }
  }

  clearRoutes(): void {
    if (this.routes.size > 0) {
      this.routes.clear();
      this.routesRevision++;
    }
    this.clearFades(this.routeFades);
  }

  rawRoute(id: string): RouteSpec | undefined {
    return this.routes.get(id);
  }

  rawRoutes(): RouteSpec[] {
    return Array.from(this.routes.values());
  }

  get routeCount(): number {
    return this.routes.size;
  }

  /** When this route's fade began, same clock as `now()` - `undefined` without one in progress. */
  routeFadeStart(id: string): number | undefined {
    return this.routeFades.get(id)?.start;
  }

  /** Whether any point or route is currently fading, so the map knows to keep drawing frames. */
  get hasFading(): boolean {
    return this.pointFades.size > 0 || this.routeFades.size > 0;
  }

  /** Cancels every pending fade timer, so none fires - and keeps this reachable - after teardown. */
  destroy(): void {
    this.clearFades(this.pointFades);
    this.clearFades(this.routeFades);
  }

  /**
   * (Re)starts a fade's countdown to removal, unless the exact same `fade` object just arrived again
   * for an id already counting down - which happens whenever `updatePoint`/`updateRoute` merges an
   * untouched `fade` back in - in which case the running countdown is left alone.
   */
  private scheduleFade(
    fades: Map<string, FadeRecord>,
    id: string,
    previousFade: Fade | undefined,
    fade: Fade | undefined,
    onExpire: () => void,
  ): void {
    if (!fade) {
      this.endFade(fades, id);
      return;
    }
    if (fade === previousFade && fades.has(id)) {
      return;
    }
    this.endFade(fades, id);
    const totalMs = Math.max(0, ((fade.in ?? 0) + (fade.stay ?? 0) + (fade.out ?? 0)) * 1000);
    const timer = setTimeout(() => {
      onExpire();
      this.onFadeExpire?.();
    }, totalMs);
    fades.set(id, { start: now(), timer });
  }

  private endFade(fades: Map<string, FadeRecord>, id: string): void {
    const fade = fades.get(id);
    if (fade) {
      clearTimeout(fade.timer);
      fades.delete(id);
    }
  }

  private clearFades(fades: Map<string, FadeRecord>): void {
    for (const fade of fades.values()) {
      clearTimeout(fade.timer);
    }
    fades.clear();
  }
}

/** Fill in every point default from the theme and configuration. */
export function resolvePoint(
  spec: PointSpec,
  theme: Theme,
  config: GlobeConfig,
  fadeStart?: number,
): ResolvedPoint {
  return {
    ...spec,
    color: spec.color ?? theme.point,
    size: spec.size ?? config.points.size,
    opacity: spec.opacity ?? 1,
    labelVisible: spec.labelVisible ?? true,
    fade: resolveFade(spec.fade),
    fadeStart,
  };
}

/** Fill in every route default from the theme and configuration. */
export function resolveRoute(
  spec: RouteSpec,
  theme: Theme,
  config: GlobeConfig,
  fadeStart?: number,
): ResolvedRoute {
  return {
    ...spec,
    color: spec.color ?? theme.route,
    width: spec.width ?? config.routes.width,
    opacity: spec.opacity ?? 1,
    labelVisible: spec.labelVisible ?? true,
    fade: resolveFade(spec.fade),
    fadeStart,
  };
}

function resolveFade(
  fade: Fade | undefined,
): { in: number; stay: number; out: number } | undefined {
  return fade ? { in: fade.in ?? 0, stay: fade.stay ?? 0, out: fade.out ?? 0 } : undefined;
}
