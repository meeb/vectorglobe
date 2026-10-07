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
import { DEFAULT_CONFIG } from '../../src/defaults.ts';
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

  it('accepts a generated route with a height in km and an autoHeight flag', () => {
    map = vectorGlobe(container, {
      points: [
        { id: 'a', lat: 0, lon: 0 },
        { id: 'b', lat: 10, lon: 10 },
      ],
      routes: [{ id: 'r', from: 'a', to: 'b', height: 500, autoHeight: true }],
    });
    expect(map.getRoute('r')).toMatchObject({ height: 500, autoHeight: true });
  });

  it('merges config.routes.autoHeight without losing the other route defaults', () => {
    map = vectorGlobe(container, { config: { routes: { autoHeight: true } } });
    const config = map.getConfig();
    expect(config.routes.autoHeight).toBe(true);
    expect(config.routes.arcHeight).toBe(0.35);
    expect(config.routes.segments).toBe(64);
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

  it('lets fit.padding and fit.minSpan be configured for a tighter frame', () => {
    const points = [
      { id: 'a', lat: 0, lon: -0.05 },
      { id: 'b', lat: 0, lon: 0.05 },
    ];

    map = vectorGlobe(container, { points });
    map.fitPoints(undefined, { animate: false });
    const defaultAltitude = map.getCamera().altitude;
    map.destroy();

    map = vectorGlobe(container, { points, config: { fit: { padding: 1.02, minSpan: 0.2 } } });
    map.fitPoints(undefined, { animate: false });
    const tightAltitude = map.getCamera().altitude;

    // Two points a tenth of a degree apart would be floored by the default minSpan (5 degrees) to
    // the same frame as two points on opposite sides of a small country - a short route needs a
    // tighter floor, and a smaller margin, to actually fill a view that is embedded small.
    expect(tightAltitude).toBeLessThan(defaultAltitude);
  });

  it('fits each axis against its own field of view, not the larger of the two spans', () => {
    // The stubbed container is 800x600 - wider than tall, so its horizontal field of view is wider
    // than its vertical one, and the same angular span needs less pulling back running east-west
    // (against that wider field) than running north-south (against the narrower one).
    map = vectorGlobe(container, {
      points: [
        { id: 'a', lat: 0, lon: -20 },
        { id: 'b', lat: 0, lon: 20 },
      ],
      config: { fit: { minSpan: 0 } },
    });
    map.fitPoints(undefined, { animate: false });
    const eastWest = map.getCamera().altitude;
    map.destroy();

    map = vectorGlobe(container, {
      points: [
        { id: 'a', lat: -20, lon: 0 },
        { id: 'b', lat: 20, lon: 0 },
      ],
      config: { fit: { minSpan: 0 } },
    });
    map.fitPoints(undefined, { animate: false });
    const northSouth = map.getCamera().altitude;

    expect(eastWest).toBeLessThan(northSouth);
  });

  it('resets to the camera it was constructed with', () => {
    map = vectorGlobe(container, { config: { camera: { lat: 40, lon: -70, altitude: 3 } } });
    map.setCamera({ lat: 12, lon: 34, altitude: 1.5 });
    map.resetCamera({ animate: false });
    expect(map.getCamera()).toMatchObject({ lat: 40, lon: -70, altitude: 3 });
  });

  it('emits when the camera changes', () => {
    map = vectorGlobe(container);
    const handler = vi.fn();
    map.on('camerachange', handler);
    map.setCamera({ lat: 5 });
    expect(handler).toHaveBeenCalled();
  });

  it('zooms by the same relative amount close to the surface as far from it', () => {
    // Regression test for the bug this replaced: scaling the raw altitude made the same wheel
    // notch change the *height* above the surface far more near the minimum zoom than far from
    // it. Scaling the height itself keeps one notch the same relative step everywhere.
    const wheel = (root: HTMLElement) =>
      root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));

    map = vectorGlobe(container, { config: { camera: { altitude: 6 } } });
    const root = container.querySelector('.vg-root') as HTMLElement;
    wheel(root);
    const farRatio = (map.getCamera().altitude - 1) / 5;

    map.setCamera({ altitude: 1.2 });
    wheel(root);
    const nearRatio = (map.getCamera().altitude - 1) / 0.2;

    expect(nearRatio).toBeCloseTo(farRatio, 6);
  });

  it('applies config.zoom.speed to wheel zoom, live', () => {
    map = vectorGlobe(container, { config: { camera: { altitude: 2 } } });
    const root = container.querySelector('.vg-root') as HTMLElement;

    map.setConfig({ zoom: { speed: 1.5 } });
    root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
    expect(map.getCamera().altitude - 1).toBeCloseTo(1 * 1.5, 6);
  });

  it('drags the surface under the cursor rather than spinning far past it at close zoom', () => {
    // Regression test for the bug this replaced: dragScale used to be based on the angular size
    // of the globe as seen from the eye, which made a drag of a small fraction of the window width
    // sweep the entire visible area many times over once zoomed in close - exactly the "a couple of
    // centimetres sends a point clean off the other side of the screen" report this fixed.
    map = vectorGlobe(container, { config: { camera: { altitude: 1.15, tilt: 0 } } });
    const root = container.querySelector('.vg-root') as HTMLElement;
    const drag = (dx: number): void => {
      root.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: 400,
          clientY: 300,
          bubbles: true,
          pointerId: 1,
        }),
      );
      root.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 400 + dx,
          clientY: 300,
          bubbles: true,
          pointerId: 1,
        }),
      );
      root.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: 400 + dx,
          clientY: 300,
          bubbles: true,
          pointerId: 1,
        }),
      );
    };

    drag(150); // 150px out of an 800px-wide container - a modest, partial-width drag.
    const swept = Math.abs(map.getCamera().lon);
    // A drag this small should turn the globe by a fraction of what's visible at this zoom, not
    // spin it repeatedly past the whole view - the old formula swept roughly 12 visible widths for
    // a full-window drag at this altitude, which this bounds well under one.
    expect(swept).toBeLessThan(30);
  });

  it('amplifies pinch zoom by config.zoom.pinchSensitivity', () => {
    // Two fingers moving from 100px apart to 200px apart - a real, physically comfortable pinch.
    const pinch = (sensitivity: number): number => {
      map = vectorGlobe(container, {
        config: { camera: { altitude: 4 }, zoom: { pinchSensitivity: sensitivity } },
      });
      const root = container.querySelector('.vg-root') as HTMLElement;
      const down = (id: number, x: number) =>
        root.dispatchEvent(
          new PointerEvent('pointerdown', {
            clientX: x,
            clientY: 300,
            bubbles: true,
            pointerId: id,
          }),
        );
      const move = (id: number, x: number) =>
        root.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX: x,
            clientY: 300,
            bubbles: true,
            pointerId: id,
          }),
        );
      down(1, 350);
      down(2, 450); // 100px apart
      move(1, 300);
      move(2, 500); // 200px apart - spreading fingers, i.e. zooming in
      const height = map.getCamera().altitude - 1;
      map.destroy();
      return height;
    };

    const defaultSensitivity = DEFAULT_CONFIG.zoom.pinchSensitivity;
    const direct = pinch(1); // sensitivity 1 matches the raw finger-distance ratio exactly
    const amplified = pinch(defaultSensitivity);

    expect(direct).toBeCloseTo(3 * 0.5, 6); // height halved, matching the 2x finger spread exactly
    // The same physical pinch should move the height further with a higher sensitivity - spreading
    // fingers 2x should cut height by more than half, not by the same amount as sensitivity 1.
    // Compared against the real default rather than a hardcoded copy of it, so this cannot go stale
    // the way the comment it replaces did the moment that default was last tuned.
    expect(amplified).toBeLessThan(direct);
    expect(amplified).toBeCloseTo(3 * 0.5 ** defaultSensitivity, 6);
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

  it('keeps drawing after the last point is removed', async () => {
    // Regression test: in the WebGL renderer (not exercised by this suite, which falls back to 2D
    // with no GPU here - see the file header) removing the last point used to leave the globe
    // permanently blank. Deleting the now-empty shared point buffer dropped it, but not the vertex
    // attribute arrays still pointing at it, which is separate, global context state - the *next*
    // draw call on the context, even one using a wholly different shader program, then failed
    // validation and silently drew nothing, every frame from then on. Covered for real against an
    // actual WebGL context with Playwright during development; kept here mainly so the land/water
    // fill this does exercise keeps happening at all once the scene is empty.
    map = vectorGlobe(container, { points: [{ id: 'only', lat: 0, lon: 0 }] });
    await new Promise((resolve) => requestAnimationFrame(resolve));

    map.removePoint('only');
    canvas.calls.length = 0;
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(map.getPoints()).toHaveLength(0);
    expect(canvas.calls).toContain('fill');
  });
});

describe('hit testing', () => {
  // A camera centred on (0, 0) at the projection's reference altitude puts that point exactly in
  // the middle of the 800x600 stubbed container, which is what makes the click coordinates below
  // land where the test expects.
  const centeredCamera = { lat: 0, lon: 0, altitude: 2.5, tilt: 0, bearing: 0 };

  const clickAt = (clientX: number, clientY: number): void => {
    const root = container.querySelector('.vg-root') as HTMLElement;
    root.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX, clientY }),
    );
    root.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX, clientY }),
    );
  };

  it('reports a click on a point', async () => {
    map = vectorGlobe(container, {
      config: { camera: centeredCamera },
      points: [{ id: 'p', lat: 0, lon: 0 }],
    });
    // Hit-testing projects through the renderer's own projection, which is only built once the
    // first frame has drawn.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const handler = vi.fn();
    map.on('click', handler);

    clickAt(400, 300);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].target).toMatchObject({ kind: 'point', id: 'p' });
  });

  it('reports a click on a route away from any decoy routes', async () => {
    // Regression test for the bounding-cone pre-check in hitTest: a route far from the pointer
    // (here, dozens on the far side of the globe) must not make the one under the pointer
    // unreachable, and a route actually under the pointer must not be skipped by the same check.
    const decoys = Array.from({ length: 40 }, (_, i) => ({
      id: `decoy-${i}`,
      path: [[170, 60] as [number, number], [175, 65] as [number, number]],
    }));
    map = vectorGlobe(container, {
      config: { camera: centeredCamera },
      routes: [
        ...decoys,
        {
          id: 'target',
          path: [
            [-10, 0],
            [0, 0],
            [10, 0],
          ],
          curve: 'linear',
        },
      ],
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const handler = vi.fn();
    map.on('click', handler);

    clickAt(400, 300);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].target).toMatchObject({ kind: 'route', id: 'target' });
  });

  it('reports no target for empty space', async () => {
    map = vectorGlobe(container, {
      config: { camera: centeredCamera },
      points: [{ id: 'p', lat: 40, lon: 40 }],
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const handler = vi.fn();
    map.on('click', handler);

    clickAt(400, 300);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].target).toBeNull();
  });

  describe('hover throttling', () => {
    let pending: Map<number, FrameRequestCallback>;

    beforeEach(() => {
      let nextHandle = 1;
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

    const tick = (): void => {
      const callbacks = Array.from(pending.values());
      pending.clear();
      for (const callback of callbacks) {
        callback(0);
      }
    };

    it('coalesces rapid pointer moves into one hit test per frame', () => {
      map = vectorGlobe(container, {
        config: { camera: centeredCamera },
        points: [{ id: 'p', lat: 0, lon: 0 }],
      });
      // rAF is stubbed in this block, so the map's own first frame needs a manual tick too, to
      // build the renderer's projection before any hit test can use it.
      tick();
      const handler = vi.fn();
      map.on('hover', handler);
      const root = container.querySelector('.vg-root') as HTMLElement;

      // Several moves before a frame fires - only the last position should be tested.
      root.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }),
      );
      root.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 200, clientY: 200 }),
      );
      root.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300 }),
      );
      expect(handler).not.toHaveBeenCalled();

      tick();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].target).toMatchObject({ kind: 'point', id: 'p' });
    });
  });
});

describe('point labels', () => {
  it('draws label, title and extraTitle as three stacked lines', async () => {
    map = vectorGlobe(container, {
      points: [
        {
          id: 'LHR',
          lat: 51.47,
          lon: -0.4543,
          label: 'LHR',
          title: 'London Heathrow',
          extraTitle: 'A very busy airport',
        },
      ],
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const label = container.querySelector('.vg-label');
    expect(label?.querySelector('.vg-label-tag')?.textContent).toBe('LHR');
    expect(label?.querySelector('.vg-label-title')?.textContent).toBe('London Heathrow');
    expect(label?.querySelector('.vg-label-extra-title')?.textContent).toBe('A very busy airport');
  });

  it('draws a label from extraTitle alone', async () => {
    map = vectorGlobe(container, {
      points: [{ id: 'LHR', lat: 51.47, lon: -0.4543, extraTitle: 'A very busy airport' }],
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const label = container.querySelector('.vg-label');
    expect(label).not.toBeNull();
    expect((label?.querySelector('.vg-label-tag') as HTMLElement)?.hidden).toBe(true);
    expect((label?.querySelector('.vg-label-title') as HTMLElement)?.hidden).toBe(true);
    expect(label?.querySelector('.vg-label-extra-title')?.textContent).toBe('A very busy airport');
  });
});

describe('route labels', () => {
  const path: [number, number][] = [
    [-10, 0],
    [10, 0],
  ];

  it('draws a label at the route midpoint when one is set', async () => {
    map = vectorGlobe(container, { routes: [{ id: 'r', path, label: 'BA178' }] });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const label = container.querySelector('.vg-route-label');
    expect(label).not.toBeNull();
    expect(label?.querySelector('.vg-label-tag')?.textContent).toBe('BA178');
  });

  it('draws no label when neither label nor title is set', async () => {
    map = vectorGlobe(container, { routes: [{ id: 'r', path }] });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(container.querySelector('.vg-route-label')).toBeNull();
  });

  it('draws title as a second line under the label, same as a point', async () => {
    map = vectorGlobe(container, {
      routes: [{ id: 'r', path, label: 'BA178', title: 'Heathrow to Kennedy' }],
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const label = container.querySelector('.vg-route-label');
    expect(label?.querySelector('.vg-label-tag')?.textContent).toBe('BA178');
    expect(label?.querySelector('.vg-label-title')?.textContent).toBe('Heathrow to Kennedy');
  });

  it('draws just a title when no label is set, same as a point', async () => {
    map = vectorGlobe(container, {
      routes: [{ id: 'r', path, title: 'Heathrow to Kennedy' }],
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const label = container.querySelector('.vg-route-label');
    expect(label).not.toBeNull();
    expect((label?.querySelector('.vg-label-tag') as HTMLElement)?.hidden).toBe(true);
    expect(label?.querySelector('.vg-label-title')?.textContent).toBe('Heathrow to Kennedy');
  });

  it('draws extraTitle as a third line under the title', async () => {
    map = vectorGlobe(container, {
      routes: [
        {
          id: 'r',
          path,
          label: 'BA178',
          title: 'Heathrow to Kennedy',
          extraTitle: 'Transatlantic',
        },
      ],
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const label = container.querySelector('.vg-route-label');
    expect(label?.querySelector('.vg-label-tag')?.textContent).toBe('BA178');
    expect(label?.querySelector('.vg-label-title')?.textContent).toBe('Heathrow to Kennedy');
    expect(label?.querySelector('.vg-label-extra-title')?.textContent).toBe('Transatlantic');
  });

  it('draws a label from extraTitle alone', async () => {
    map = vectorGlobe(container, {
      routes: [{ id: 'r', path, extraTitle: 'Transatlantic' }],
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const label = container.querySelector('.vg-route-label');
    expect(label).not.toBeNull();
    expect((label?.querySelector('.vg-label-tag') as HTMLElement)?.hidden).toBe(true);
    expect((label?.querySelector('.vg-label-title') as HTMLElement)?.hidden).toBe(true);
    expect(label?.querySelector('.vg-label-extra-title')?.textContent).toBe('Transatlantic');
  });

  it('respects labelVisible', async () => {
    map = vectorGlobe(container, {
      routes: [{ id: 'r', path, label: 'BA178', labelVisible: false }],
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(container.querySelector('.vg-route-label')).toBeNull();
  });

  it('themes route labels independently of point labels', () => {
    map = vectorGlobe(container, {
      theme: { routeLabel: '#ff0000', routeLabelBackground: '#001122' },
    });
    const root = container.querySelector('.vg-root') as HTMLElement;
    expect(root.style.getPropertyValue('--vg-route-label')).toBe('#ff0000');
    expect(root.style.getPropertyValue('--vg-route-label-background')).toBe('#001122');
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

describe('fading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes a point automatically once its fade finishes', () => {
    map = vectorGlobe(container, {
      points: [{ id: 'p', lat: 0, lon: 0, fade: { in: 0.1, stay: 1, out: 0.5 } }],
    });
    vi.advanceTimersByTime(16);
    expect(map.getPoints()).toHaveLength(1);

    vi.advanceTimersByTime(1600);
    expect(map.getPoints()).toHaveLength(0);
  });

  it('removes a route automatically once its fade finishes', () => {
    map = vectorGlobe(container, {
      points: [
        { id: 'a', lat: 0, lon: 0 },
        { id: 'b', lat: 10, lon: 10 },
      ],
      routes: [{ id: 'r', from: 'a', to: 'b', fade: { stay: 1 } }],
    });
    vi.advanceTimersByTime(16);
    expect(map.getRoutes()).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(map.getRoutes()).toHaveLength(0);
  });

  it('fades a label out over time', () => {
    map = vectorGlobe(container, {
      points: [{ id: 'p', lat: 0, lon: 0, label: 'P', fade: { in: 1, stay: 0, out: 1 } }],
    });
    vi.advanceTimersByTime(16);
    const label = container.querySelector('.vg-label') as HTMLElement;

    // Partway through the rise.
    vi.advanceTimersByTime(500 - 16);
    expect(Number(label.style.opacity)).toBeGreaterThan(0.3);
    expect(Number(label.style.opacity)).toBeLessThan(0.7);

    // Partway through the fall.
    vi.advanceTimersByTime(1000);
    expect(Number(label.style.opacity)).toBeGreaterThan(0.3);
    expect(Number(label.style.opacity)).toBeLessThan(0.7);
  });

  it('does not keep drawing once nothing is fading any more', () => {
    map = vectorGlobe(container, {
      points: [{ id: 'p', lat: 0, lon: 0, fade: { stay: 0.1 } }],
    });
    vi.advanceTimersByTime(200);
    expect(map.getPoints()).toHaveLength(0);

    canvas.calls.length = 0;
    vi.advanceTimersByTime(500);
    expect(canvas.calls.length).toBe(0);
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
