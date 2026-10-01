import { describe, expect, it } from 'vitest';
import { Camera, MAX_TILT } from '../src/core/camera.ts';
import { lonLatToVec3 } from '../src/math/geo.ts';
import { dot, normalize, sub } from '../src/math/vec3.ts';

const limits = { min: 1.15, max: 8 };
const start = { lat: 0, lon: 0, altitude: 2.5, tilt: 0, bearing: 0 };

describe('camera state', () => {
  it('clamps everything into range on construction', () => {
    const camera = new Camera({ lat: 120, lon: 400, altitude: 99, tilt: 200, bearing: 0 }, limits);
    expect(camera.lat).toBe(90);
    expect(camera.lon).toBeCloseTo(40, 6);
    expect(camera.altitude).toBe(limits.max);
    expect(camera.tilt).toBe(MAX_TILT);
  });

  it('wraps longitude and clamps latitude while rotating', () => {
    const camera = new Camera(start, limits);
    camera.rotateBy(200, 100);
    expect(camera.lon).toBeCloseTo(-160, 6);
    expect(camera.lat).toBe(90);
  });

  it('zooms by scaling the height above the surface, and respects the limits', () => {
    const camera = new Camera(start, limits);
    // Altitude 2.5 is 1.5 above the surface; doubling that height lands at altitude 4, not 5 -
    // multiplying the raw altitude directly was the bug this guards against (see zoomBy's docs).
    camera.zoomBy(2);
    expect(camera.altitude).toBe(4);
    camera.zoomBy(100);
    expect(camera.altitude).toBe(limits.max);
    camera.zoomBy(0.0001);
    expect(camera.altitude).toBe(limits.min);
  });

  it('keeps one zoom step the same relative size close to the surface as far from it', () => {
    // This is the actual bug report: scaling the raw altitude made the same wheel notch cut a much
    // bigger fraction off your height the closer you already were to the surface. Scaling the
    // height itself keeps the fraction constant at any distance.
    const factor = 0.85;
    const far = new Camera({ ...start, altitude: 6 }, limits);
    const near = new Camera({ ...start, altitude: 1.2 }, limits);
    far.zoomBy(factor);
    near.zoomBy(factor);
    expect((far.altitude - 1) / 5).toBeCloseTo(factor, 10);
    expect((near.altitude - 1) / 0.2).toBeCloseTo(factor, 10);
  });

  it('can still zoom back out after a step lands exactly on the surface', () => {
    const camera = new Camera({ ...start, altitude: 1.15 }, { min: 1, max: 8 });
    camera.zoomBy(0); // height collapses to 0 (clamped away from it, not left exactly there)
    camera.zoomBy(2);
    expect(camera.altitude).toBeGreaterThan(1);
  });

  it('pulls the altitude back into range when the limits change', () => {
    const camera = new Camera(start, limits);
    camera.setLimits({ min: 1.1, max: 2 });
    expect(camera.altitude).toBe(2);
  });
});

describe('camera animation', () => {
  it('interpolates and then finishes', () => {
    const camera = new Camera(start, limits);
    camera.animateTo({ lat: 50, altitude: 4 }, 1000, 0);
    expect(camera.animating).toBe(true);

    expect(camera.update(500)).toBe(true);
    expect(camera.lat).toBeGreaterThan(0);
    expect(camera.lat).toBeLessThan(50);

    expect(camera.update(1000)).toBe(false);
    expect(camera.lat).toBeCloseTo(50, 6);
    expect(camera.altitude).toBeCloseTo(4, 6);
    expect(camera.animating).toBe(false);
  });

  it('takes the short way round the date line', () => {
    const camera = new Camera({ ...start, lon: 170 }, limits);
    camera.animateTo({ lon: -170 }, 1000, 0);
    camera.update(500);
    // Half way between 170 and -170 the short way is the date line, not the prime meridian.
    expect(Math.abs(camera.lon)).toBeGreaterThan(175);
  });

  it('is cancelled by direct input', () => {
    const camera = new Camera(start, limits);
    camera.animateTo({ lat: 50 }, 1000, 0);
    camera.rotateBy(1, 0);
    expect(camera.animating).toBe(false);
  });
});

describe('camera placement', () => {
  it('looks straight down at the focus point with no tilt', () => {
    const camera = new Camera({ ...start, lat: 30, lon: 45 }, limits);
    const { eye, target, up } = camera.view();
    const focus = lonLatToVec3(45, 30, 1);

    expect(target[0]).toBeCloseTo(focus[0], 6);
    expect(Math.hypot(eye[0], eye[1], eye[2])).toBeCloseTo(2.5, 6);
    // The eye sits on the line from the centre through the focus point.
    expect(dot(normalize(eye), normalize(focus))).toBeCloseTo(1, 6);
    // Up points north, so it has a positive component towards the pole.
    expect(up[1]).toBeGreaterThan(0);
  });

  it('keeps its distance from the focus when tilted', () => {
    const upright = new Camera({ ...start, lat: 20 }, limits).view();
    const tilted = new Camera({ ...start, lat: 20, tilt: 45 }, limits).view();
    const distance = (view: { eye: number[]; target: number[] }): number =>
      Math.hypot(
        view.eye[0] - view.target[0],
        view.eye[1] - view.target[1],
        view.eye[2] - view.target[2],
      );

    expect(distance(tilted)).toBeCloseTo(distance(upright), 6);
    // Tilting moves the eye somewhere else, rather than just spinning in place.
    expect(sub(tilted.eye, upright.eye).some((component) => Math.abs(component) > 0.1)).toBe(true);
  });

  it('builds a usable view projection matrix', () => {
    const camera = new Camera(start, limits);
    const { matrix, eye } = camera.viewProjection(16 / 9);
    expect(matrix.length).toBe(16);
    expect(matrix.every((value) => Number.isFinite(value))).toBe(true);
    expect(eye[2]).toBeCloseTo(2.5, 6);
  });

  it('works at the poles, where the north tangent degenerates', () => {
    const camera = new Camera({ ...start, lat: 90 }, limits);
    const { matrix } = camera.viewProjection(1);
    expect(matrix.every((value) => Number.isFinite(value))).toBe(true);
  });
});

describe('fitting a span', () => {
  it('pulls further back the more of the world has to fit', () => {
    const near = Camera.altitudeForSpan(10, limits);
    const far = Camera.altitudeForSpan(120, limits);
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThanOrEqual(limits.min);
    expect(far).toBeLessThanOrEqual(limits.max);
  });

  it('pulls back less for the same span against a wider field of view', () => {
    const narrowFov = Camera.altitudeForSpan(20, limits, { fov: 0.4 });
    const wideFov = Camera.altitudeForSpan(20, limits, { fov: 0.8 });
    expect(wideFov).toBeLessThan(narrowFov);
  });

  it('scales the margin left around the fitted span with padding', () => {
    const snug = Camera.altitudeForSpan(20, limits, { padding: 1 });
    const padded = Camera.altitudeForSpan(20, limits, { padding: 1.3 });
    expect(padded).toBeGreaterThan(snug);
  });
});
