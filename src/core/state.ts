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
  GlobeConfig,
  PointSpec,
  ResolvedPoint,
  ResolvedRoute,
  RouteSpec,
  Theme,
} from '../types.ts';

export class SceneState {
  private points = new Map<string, PointSpec>();
  private routes = new Map<string, RouteSpec>();

  /** Bumped whenever the set of points changes in a way that needs new geometry. */
  pointsRevision = 0;
  /** Bumped whenever the set of routes changes. */
  routesRevision = 0;

  addPoint(spec: PointSpec): void {
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) {
      throw new Error('vectorglobe: a point needs a non-empty string id');
    }
    if (!Number.isFinite(spec.lat) || !Number.isFinite(spec.lon)) {
      throw new Error(`vectorglobe: point "${spec.id}" needs finite lat and lon values`);
    }
    this.points.set(spec.id, { ...spec });
    this.pointsRevision++;
    // A route may be anchored to this point, so its geometry has to be rebuilt too.
    this.routesRevision++;
  }

  updatePoint(id: string, changes: Partial<Omit<PointSpec, 'id'>>): void {
    const existing = this.points.get(id);
    if (!existing) {
      throw new Error(`vectorglobe: no point with id "${id}"`);
    }
    this.addPoint({ ...existing, ...changes, id });
  }

  removePoint(id: string): void {
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
    this.routes.set(spec.id, { ...spec });
    this.routesRevision++;
  }

  updateRoute(id: string, changes: Partial<Omit<RouteSpec, 'id'>>): void {
    const existing = this.routes.get(id);
    if (!existing) {
      throw new Error(`vectorglobe: no route with id "${id}"`);
    }
    this.addRoute({ ...existing, ...changes, id });
  }

  removeRoute(id: string): void {
    if (this.routes.delete(id)) {
      this.routesRevision++;
    }
  }

  clearRoutes(): void {
    if (this.routes.size > 0) {
      this.routes.clear();
      this.routesRevision++;
    }
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
}

/** Fill in every point default from the theme and configuration. */
export function resolvePoint(spec: PointSpec, theme: Theme, config: GlobeConfig): ResolvedPoint {
  return {
    ...spec,
    color: spec.color ?? theme.point,
    size: spec.size ?? config.points.size,
    opacity: spec.opacity ?? 1,
    labelVisible: spec.labelVisible ?? true,
  };
}

/** Fill in every route default from the theme and configuration. */
export function resolveRoute(spec: RouteSpec, theme: Theme, config: GlobeConfig): ResolvedRoute {
  return {
    ...spec,
    color: spec.color ?? theme.route,
    width: spec.width ?? config.routes.width,
    opacity: spec.opacity ?? 1,
    labelVisible: spec.labelVisible ?? true,
  };
}
