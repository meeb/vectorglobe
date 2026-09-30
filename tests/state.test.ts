import { describe, expect, it } from 'vitest';
import { resolvePoint, resolveRoute, SceneState } from '../src/core/state.ts';
import { DEFAULT_CONFIG, DEFAULT_THEME } from '../src/defaults.ts';

const point = { id: 'LHR', lat: 51.47, lon: -0.45 };

describe('points', () => {
  it('adds, reads back and removes by id', () => {
    const state = new SceneState();
    state.addPoint(point);
    expect(state.pointCount).toBe(1);
    expect(state.rawPoint('LHR')?.lat).toBe(51.47);
    state.removePoint('LHR');
    expect(state.rawPoint('LHR')).toBeUndefined();
  });

  it('replaces a point added again with the same id', () => {
    const state = new SceneState();
    state.addPoint(point);
    state.addPoint({ ...point, lat: 10 });
    expect(state.pointCount).toBe(1);
    expect(state.rawPoint('LHR')?.lat).toBe(10);
  });

  it('merges partial updates', () => {
    const state = new SceneState();
    state.addPoint({ ...point, label: 'LHR', title: 'Heathrow' });
    state.updatePoint('LHR', { color: '#fff' });
    expect(state.rawPoint('LHR')).toMatchObject({ title: 'Heathrow', color: '#fff' });
  });

  it('stores a copy so the caller cannot mutate the map behind its back', () => {
    const state = new SceneState();
    const original = { ...point };
    state.addPoint(original);
    original.lat = 0;
    expect(state.rawPoint('LHR')?.lat).toBe(51.47);
  });

  it('rejects input that would silently draw nothing', () => {
    const state = new SceneState();
    expect(() => state.addPoint({ id: '', lat: 0, lon: 0 })).toThrow(/non-empty string id/);
    expect(() => state.addPoint({ id: 'x', lat: Number.NaN, lon: 0 })).toThrow(/finite/);
    expect(() => state.updatePoint('nope', {})).toThrow(/no point with id/);
  });

  it('bumps the revision on every change, including route geometry that depends on points', () => {
    const state = new SceneState();
    const points = state.pointsRevision;
    const routes = state.routesRevision;
    state.addPoint(point);
    expect(state.pointsRevision).toBeGreaterThan(points);
    expect(state.routesRevision).toBeGreaterThan(routes);
  });

  it('leaves the revision alone when removing something that was never there', () => {
    const state = new SceneState();
    const revision = state.pointsRevision;
    state.removePoint('missing');
    state.clearPoints();
    expect(state.pointsRevision).toBe(revision);
  });
});

describe('routes', () => {
  it('accepts a pair of point ids', () => {
    const state = new SceneState();
    state.addRoute({ id: 'a', from: 'LHR', to: 'JFK' });
    expect(state.routeCount).toBe(1);
  });

  it('accepts an explicit path', () => {
    const state = new SceneState();
    state.addRoute({
      id: 'b',
      path: [
        [0, 0],
        [10, 10, 11],
      ],
    });
    expect(state.rawRoute('b')?.path?.length).toBe(2);
  });

  it('rejects a route that describes no geometry', () => {
    const state = new SceneState();
    expect(() => state.addRoute({ id: 'c' })).toThrow(/from and to point ids, or a path/);
    expect(() => state.addRoute({ id: 'd', path: [[0, 0]] })).toThrow(/at least two coordinates/);
    expect(() => state.addRoute({ id: 'e', from: 'LHR' })).toThrow(/from and to/);
  });
});

describe('resolving defaults', () => {
  it('falls back to the theme and configuration', () => {
    const resolved = resolvePoint(point, DEFAULT_THEME, DEFAULT_CONFIG);
    expect(resolved.color).toBe(DEFAULT_THEME.point);
    expect(resolved.size).toBe(DEFAULT_CONFIG.points.size);
    expect(resolved.opacity).toBe(1);
    expect(resolved.labelVisible).toBe(true);
  });

  it('keeps anything the caller set', () => {
    const resolved = resolvePoint(
      { ...point, color: '#abcdef', size: 12, opacity: 0.5, labelVisible: false },
      DEFAULT_THEME,
      DEFAULT_CONFIG,
    );
    expect(resolved).toMatchObject({
      color: '#abcdef',
      size: 12,
      opacity: 0.5,
      labelVisible: false,
    });
  });

  it('resolves routes the same way', () => {
    const resolved = resolveRoute({ id: 'r', from: 'a', to: 'b' }, DEFAULT_THEME, DEFAULT_CONFIG);
    expect(resolved.color).toBe(DEFAULT_THEME.route);
    expect(resolved.width).toBe(DEFAULT_CONFIG.routes.width);
  });
});
