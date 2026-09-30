import { describe, expect, it } from 'vitest';
import { FlatProjection, unwrapLongitudes } from '../src/render/canvas2d/projection.ts';

const size = { width: 800, height: 400 };

describe('equirectangular projection', () => {
  const projection = new FlatProjection(size.width, size.height, 0, 0, 2.5, 'equirectangular');

  it('puts the centre of the view at the camera position', () => {
    expect(projection.project(0, 0)).toEqual([400, 200]);
  });

  it('spans the container width with one world at the reference altitude', () => {
    expect(projection.worldWidth).toBeCloseTo(800, 6);
  });

  it('round trips positions', () => {
    for (const [lon, lat] of [
      [0, 0],
      [45, -30],
      [-120, 60],
      [179, -85],
    ]) {
      const [x, y] = projection.project(lon, lat);
      const [backLon, backLat] = projection.unproject(x, y);
      expect(backLon).toBeCloseTo(lon, 6);
      expect(backLat).toBeCloseTo(lat, 6);
    }
  });

  it('keeps longitude and latitude at the same scale', () => {
    const [x1] = projection.project(10, 0);
    const [x0] = projection.project(0, 0);
    const [, y1] = projection.project(0, 10);
    const [, y0] = projection.project(0, 0);
    expect(x1 - x0).toBeCloseTo(y0 - y1, 6);
  });

  it('zooms in as the camera drops towards the surface', () => {
    const close = new FlatProjection(size.width, size.height, 0, 0, 1.75, 'equirectangular');
    expect(close.scale).toBeCloseTo(projection.scale * 2, 6);
  });

  it('follows the camera centre', () => {
    const shifted = new FlatProjection(size.width, size.height, 90, 0, 2.5, 'equirectangular');
    expect(shifted.project(90, 0)[0]).toBeCloseTo(400, 6);
  });
});

describe('mercator projection', () => {
  const projection = new FlatProjection(size.width, size.height, 0, 0, 2.5, 'mercator');

  it('round trips positions', () => {
    for (const [lon, lat] of [
      [0, 0],
      [30, 45],
      [-60, -70],
    ]) {
      const [x, y] = projection.project(lon, lat);
      const [backLon, backLat] = projection.unproject(x, y);
      expect(backLon).toBeCloseTo(lon, 6);
      expect(backLat).toBeCloseTo(lat, 6);
    }
  });

  it('stretches higher latitudes, unlike equirectangular', () => {
    const flat = new FlatProjection(size.width, size.height, 0, 0, 2.5, 'equirectangular');
    const mercatorSpan = Math.abs(projection.project(0, 60)[1] - projection.project(0, 0)[1]);
    const flatSpan = Math.abs(flat.project(0, 60)[1] - flat.project(0, 0)[1]);
    expect(mercatorSpan).toBeGreaterThan(flatSpan);
  });

  it('stays finite at the poles', () => {
    expect(Number.isFinite(projection.project(0, 90)[1])).toBe(true);
    expect(Number.isFinite(projection.project(0, -90)[1])).toBe(true);
  });
});

describe('world copies', () => {
  it('covers the container when zoomed in', () => {
    const projection = new FlatProjection(size.width, size.height, 0, 0, 1.2, 'equirectangular');
    const copies = projection.visibleCopies();
    expect(copies.length).toBeGreaterThanOrEqual(1);
    expect(copies).toContain(0);
  });

  it('offers a copy either side when the world is narrower than the view', () => {
    const projection = new FlatProjection(size.width, size.height, 0, 0, 6, 'equirectangular');
    const copies = projection.visibleCopies();
    expect(copies.some((offset) => offset > 0)).toBe(true);
    expect(copies.some((offset) => offset < 0)).toBe(true);
  });
});

describe('unwrapping longitudes', () => {
  it('turns a date line jump into a continuous run', () => {
    const points = [170, 0, 175, 0, -179, 0, -175, 0];
    unwrapLongitudes(points);
    expect(points[4]).toBeCloseTo(181, 6);
    expect(points[6]).toBeCloseTo(185, 6);
  });

  it('leaves an ordinary path alone', () => {
    const points = [0, 0, 10, 0, 20, 0];
    unwrapLongitudes(points);
    expect(points).toEqual([0, 0, 10, 0, 20, 0]);
  });

  it('unwraps in the other direction too', () => {
    const points = [-175, 0, 179, 0];
    unwrapLongitudes(points);
    expect(points[2]).toBeCloseTo(-181, 6);
  });
});
