/**
 * @vitest-environment happy-dom
 *
 * End to end checks against a real DOM.
 *
 * There is no GPU here, so this exercises the path a browser without WebGL takes: the map must fall
 * back to the 2D renderer on its own, and everything else must behave the same.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCapabilityCache } from '../../src/core/capabilities.ts';
import { vectorGlobe } from '../../src/index.ts';
import type { VectorGlobeInstance } from '../../src/types.ts';

/** Records the 2D calls the renderer makes, so drawing can be asserted without pixels. */
function stubCanvas(): { calls: string[] } {
  const calls: string[] = [];
  const context = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === 'canvas') {
          return undefined;
        }
        return () => {
          calls.push(property);
          if (property === 'getImageData') {
            return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
          }
          return undefined;
        };
      },
      set() {
        return true;
      },
    },
  );

  HTMLCanvasElement.prototype.getContext = vi.fn((kind: string) =>
    kind === '2d' ? (context as unknown as CanvasRenderingContext2D) : null,
  ) as typeof HTMLCanvasElement.prototype.getContext;

  return { calls };
}

function createContainer(): HTMLElement {
  const container = document.createElement('div');
  container.getBoundingClientRect = () =>
    ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0 }) as DOMRect;
  document.body.appendChild(container);
  return container;
}

let map: VectorGlobeInstance | null = null;
let container: HTMLElement;
let canvas: { calls: string[] };

beforeEach(() => {
  resetCapabilityCache();
  canvas = stubCanvas();
  container = createContainer();
});

afterEach(() => {
  map?.destroy();
  map = null;
  container.remove();
});

describe('binding to a container', () => {
  it('falls back to the 2D renderer when WebGL is unavailable', () => {
    map = vectorGlobe(container);
    expect(map.mode).toBe('2d');
  });

  it('builds its own DOM inside the container', () => {
    map = vectorGlobe(container);
    expect(container.querySelector('.vg-root')).not.toBeNull();
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.querySelector('.vg-labels')).not.toBeNull();
    expect(document.getElementById('vectorglobe-styles')).not.toBeNull();
  });

  it('announces itself once it is ready', async () => {
    map = vectorGlobe(container);
    const ready = vi.fn();
    map.on('ready', ready);
    await Promise.resolve();
    expect(ready).toHaveBeenCalledWith({ mode: '2d' });
  });

  it('refuses a container it cannot attach to', () => {
    expect(() => vectorGlobe(null as unknown as HTMLElement)).toThrow(
      /container element is required/,
    );
  });
});

describe('scene contents', () => {
  it('accepts points and routes up front and reads them back resolved', () => {
    map = vectorGlobe(container, {
      points: [{ id: 'LHR', lat: 51.47, lon: -0.45, label: 'LHR' }],
      routes: [{ id: 'r', from: 'LHR', to: 'LHR' }],
    });

    expect(map.getPoints()).toHaveLength(1);
    expect(map.getPoint('LHR')?.color).toBe(map.getTheme().point);
    expect(map.getRoutes()).toHaveLength(1);
  });

  it('chains', () => {
    map = vectorGlobe(container);
    const returned = map
      .addPoint({ id: 'a', lat: 0, lon: 0 })
      .addPoint({ id: 'b', lat: 10, lon: 10 })
      .addRoute({ id: 'ab', from: 'a', to: 'b' })
      .removePoint('b');
    expect(returned).toBe(map);
    expect(map.getPoints()).toHaveLength(1);
  });

  it('clears', () => {
    map = vectorGlobe(container, {
      points: [{ id: 'a', lat: 0, lon: 0 }],
      routes: [
        {
          id: 'r',
          path: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
    });
    map.clearPoints().clearRoutes();
    expect(map.getPoints()).toHaveLength(0);
    expect(map.getRoutes()).toHaveLength(0);
  });
});

describe('styling', () => {
  it('applies a theme at construction and afterwards', () => {
    map = vectorGlobe(container, { theme: { point: '#123456' } });
    expect(map.getTheme().point).toBe('#123456');

    map.setTheme({ point: '#abcdef' });
    expect(map.getTheme().point).toBe('#abcdef');
    const root = container.querySelector('.vg-root') as HTMLElement;
    expect(root.style.getPropertyValue('--vg-point')).toBe('#abcdef');
  });

  it('merges configuration without losing defaults', () => {
    map = vectorGlobe(container, { config: { graticule: { enabled: true } } });
    const config = map.getConfig();
    expect(config.graticule.enabled).toBe(true);
    expect(config.graticule.step).toBe(15);
    expect(config.labels.enabled).toBe(true);
  });

  it('hands back a copy of the configuration rather than its own', () => {
    map = vectorGlobe(container);
    const config = map.getConfig();
    config.camera.lat = 999;
    expect(map.getConfig().camera.lat).not.toBe(999);
  });
});

describe('camera', () => {
  it('starts where it was told to', () => {
    map = vectorGlobe(container, { config: { camera: { lat: 40, lon: -70, altitude: 3 } } });
    expect(map.getCamera()).toMatchObject({ lat: 40, lon: -70, altitude: 3 });
  });

  it('moves immediately when not animating', () => {
    map = vectorGlobe(container);
    map.setCamera({ lat: 12, lon: 34 });
    expect(map.getCamera()).toMatchObject({ lat: 12, lon: 34 });
  });

  it('flies to a point by id', () => {
    map = vectorGlobe(container, { points: [{ id: 'NRT', lat: 35.77, lon: 140.39 }] });
    map.flyTo('NRT', { animate: false });
    expect(map.getCamera().lat).toBeCloseTo(35.77, 2);
  });

  it('reports a point it does not know about', () => {
    map = vectorGlobe(container);
    expect(() => map?.flyTo('nowhere')).toThrow(/no point with id/);
  });

  it('frames the points it is given', () => {
    map = vectorGlobe(container, {
      points: [
        { id: 'a', lat: 10, lon: 10 },
        { id: 'b', lat: 20, lon: 20 },
      ],
    });
    map.fitPoints(undefined, { animate: false });
    const camera = map.getCamera();
    expect(camera.lat).toBeCloseTo(15, 1);
    expect(camera.lon).toBeCloseTo(15, 1);
  });

  it('emits when the camera changes', () => {
    map = vectorGlobe(container);
    const handler = vi.fn();
    map.on('camerachange', handler);
    map.setCamera({ lat: 5 });
    expect(handler).toHaveBeenCalled();
  });
});

describe('drawing', () => {
  it('draws a frame with land, borders, routes and dots', async () => {
    map = vectorGlobe(container, {
      points: [{ id: 'a', lat: 0, lon: 0, label: 'A' }],
      routes: [
        {
          id: 'r',
          path: [
            [0, 0],
            [20, 20],
          ],
        },
      ],
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(canvas.calls).toContain('fill');
    expect(canvas.calls).toContain('stroke');
    expect(canvas.calls).toContain('arc');
  });
});

describe('idle rotation', () => {
  // happy-dom hands every animation frame the same timestamp, so frames are driven by a controlled
  // clock here. That also makes the timing assertions below exact rather than flaky.
  let clock = 0;
  let nextHandle = 1;
  let pending: Map<number, FrameRequestCallback>;

  const tick = (milliseconds = 16): void => {
    clock += milliseconds;
    const callbacks = Array.from(pending.values());
    pending.clear();
    for (const callback of callbacks) {
      callback(clock);
    }
  };

  beforeEach(() => {
    clock = 0;
    nextHandle = 1;
    pending = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => pending.delete(handle));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('advances longitude at the configured speed', () => {
    map = vectorGlobe(container, {
      config: { camera: { lon: 0 }, autoRotate: { enabled: true, speed: 60 } },
    });

    // The first frame only establishes a timestamp to measure the next one against.
    tick();
    // A second of frames at 60 degrees per second is a sixth of the way round.
    for (let i = 0; i < 10; i++) {
      tick(100);
    }
    expect(map.getCamera().lon).toBeCloseTo(60, 1);
  });

  it('never lurches after the map has been sitting idle', () => {
    map = vectorGlobe(container, {
      config: { camera: { lon: 0 }, autoRotate: { enabled: true, speed: 60 } },
    });

    tick();
    // A gap of five minutes, which is what a frame delta looks like when nothing has changed.
    tick(300000);
    // Clamped to a tenth of a second of rotation rather than five minutes of it.
    expect(map.getCamera().lon).toBeCloseTo(6, 1);
  });

  it('starts rotating even if the user interacted before it was switched on', () => {
    map = vectorGlobe(container);
    const root = container.querySelector('.vg-root') as HTMLElement;
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    map.setConfig({ camera: { lon: 0 }, autoRotate: { enabled: true, speed: 60 } });
    tick();
    tick(100);
    expect(map.getCamera().lon).toBeCloseTo(6, 1);
  });

  it('stops when the user takes hold of the globe', () => {
    map = vectorGlobe(container, {
      config: {
        camera: { lon: 0 },
        autoRotate: { enabled: true, speed: 60, pauseOnInteract: true },
      },
    });
    tick();
    tick(100);
    const afterRotating = map.getCamera().lon;

    const root = container.querySelector('.vg-root') as HTMLElement;
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    tick(100);
    tick(100);
    expect(map.getCamera().lon).toBeCloseTo(afterRotating, 5);
  });

  it('stays still when it is switched off', () => {
    map = vectorGlobe(container, { config: { camera: { lon: 0 } } });
    tick();
    tick(1000);
    expect(map.getCamera().lon).toBe(0);
  });
});

describe('teardown', () => {
  it('removes everything it added', () => {
    map = vectorGlobe(container);
    map.destroy();
    map = null;
    expect(container.querySelector('.vg-root')).toBeNull();
  });

  it('can be destroyed twice', () => {
    const instance = vectorGlobe(container);
    instance.destroy();
    expect(() => instance.destroy()).not.toThrow();
  });
});
