import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('fading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes a point on its own once its fade has fully run out', () => {
    const state = new SceneState();
    state.addPoint({ ...point, fade: { in: 0.1, stay: 1, out: 0.5 } });
    expect(state.rawPoint('LHR')).not.toBeUndefined();
    expect(state.hasFading).toBe(true);

    vi.advanceTimersByTime(1599);
    expect(state.rawPoint('LHR')).not.toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(state.rawPoint('LHR')).toBeUndefined();
    expect(state.hasFading).toBe(false);
  });

  it('removes a route on its own the same way', () => {
    const state = new SceneState();
    state.addRoute({ id: 'r', from: 'a', to: 'b', fade: { stay: 1 } });
    expect(state.hasFading).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(state.rawRoute('r')).toBeUndefined();
    expect(state.hasFading).toBe(false);
  });

  it('calls back when a fade expires, since that happens outside any caller-initiated change', () => {
    const onFadeExpire = vi.fn();
    const state = new SceneState(onFadeExpire);
    state.addPoint({ ...point, fade: { stay: 1 } });

    vi.advanceTimersByTime(999);
    expect(onFadeExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFadeExpire).toHaveBeenCalledTimes(1);
  });

  it('does not restart a running countdown when the same fade object is merged back in', () => {
    const fade = { stay: 1 };
    const state = new SceneState();
    state.addPoint({ ...point, fade });

    vi.advanceTimersByTime(900);
    // Touches something unrelated; `fade` rides along unchanged via the merge in updatePoint.
    state.updatePoint('LHR', { color: '#fff' });
    vi.advanceTimersByTime(100);

    expect(state.rawPoint('LHR')).toBeUndefined();
  });

  it('restarts the countdown when a genuinely new fade is given', () => {
    const state = new SceneState();
    state.addPoint({ ...point, fade: { stay: 1 } });

    vi.advanceTimersByTime(900);
    state.updatePoint('LHR', { fade: { stay: 1 } });
    vi.advanceTimersByTime(100);

    // The original countdown would have finished by now; the restarted one has not.
    expect(state.rawPoint('LHR')).not.toBeUndefined();

    vi.advanceTimersByTime(900);
    expect(state.rawPoint('LHR')).toBeUndefined();
  });

  it('cancels the timer when the point is removed before it fires', () => {
    const onFadeExpire = vi.fn();
    const state = new SceneState(onFadeExpire);
    state.addPoint({ ...point, fade: { stay: 1 } });
    state.removePoint('LHR');

    vi.advanceTimersByTime(2000);
    expect(onFadeExpire).not.toHaveBeenCalled();
    expect(state.hasFading).toBe(false);
  });

  it('cancels every pending timer on clearPoints and clearRoutes', () => {
    const onFadeExpire = vi.fn();
    const state = new SceneState(onFadeExpire);
    state.addPoint({ ...point, fade: { stay: 1 } });
    state.addRoute({ id: 'r', from: 'a', to: 'b', fade: { stay: 1 } });
    state.clearPoints();
    state.clearRoutes();

    vi.advanceTimersByTime(2000);
    expect(onFadeExpire).not.toHaveBeenCalled();
    expect(state.hasFading).toBe(false);
  });

  it('cancels every pending timer on destroy, so none fires afterwards', () => {
    const onFadeExpire = vi.fn();
    const state = new SceneState(onFadeExpire);
    state.addPoint({ ...point, fade: { stay: 1 } });
    state.destroy();

    vi.advanceTimersByTime(2000);
    expect(onFadeExpire).not.toHaveBeenCalled();
  });

  it('exposes when a point or route started fading', () => {
    const state = new SceneState();
    expect(state.pointFadeStart('LHR')).toBeUndefined();
    state.addPoint({ ...point, fade: { stay: 1 } });
    expect(state.pointFadeStart('LHR')).toBeTypeOf('number');
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
    expect(resolved.labelVisible).toBe(true);
  });

  it('lets a route label be turned off explicitly', () => {
    const resolved = resolveRoute(
      { id: 'r', from: 'a', to: 'b', label: 'BA178', labelVisible: false },
      DEFAULT_THEME,
      DEFAULT_CONFIG,
    );
    expect(resolved).toMatchObject({ label: 'BA178', labelVisible: false });
  });

  it('keeps a route title, the same second label line a point has', () => {
    const resolved = resolveRoute(
      { id: 'r', from: 'a', to: 'b', label: 'BA178', title: 'Heathrow to Kennedy' },
      DEFAULT_THEME,
      DEFAULT_CONFIG,
    );
    expect(resolved).toMatchObject({ label: 'BA178', title: 'Heathrow to Kennedy' });
  });
});
