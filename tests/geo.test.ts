import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  clampLat,
  EARTH_RADIUS_KM,
  kmToRadius,
  lonLatToVec3,
  normalizeLon,
  splitAtAntimeridian,
  vec3ToLonLat,
} from '../src/math/geo.ts';

describe('coordinate conversion', () => {
  it('places the origin of the coordinate system on the prime meridian at the equator', () => {
    expect(lonLatToVec3(0, 0)).toEqual([0, 0, 1]);
  });

  it('puts north at the top and east to the right', () => {
    const north = lonLatToVec3(0, 90);
    expect(north[1]).toBeCloseTo(1, 10);
    const east = lonLatToVec3(90, 0);
    expect(east[0]).toBeCloseTo(1, 10);
  });

  it('round trips longitude and latitude', () => {
    for (const [lon, lat] of [
      [0, 0],
      [-73.78, 40.64],
      [140.39, 35.77],
      [151.18, -33.94],
      [179.9, -89.9],
    ]) {
      const [backLon, backLat] = vec3ToLonLat(lonLatToVec3(lon, lat));
      expect(backLon).toBeCloseTo(lon, 6);
      expect(backLat).toBeCloseTo(lat, 6);
    }
  });

  it('scales by the requested radius', () => {
    const position = lonLatToVec3(12, 34, 2);
    expect(Math.hypot(position[0], position[1], position[2])).toBeCloseTo(2, 10);
  });
});

describe('wrapping and clamping', () => {
  it('wraps longitude into the usual range', () => {
    expect(normalizeLon(190)).toBeCloseTo(-170, 10);
    expect(normalizeLon(-190)).toBeCloseTo(170, 10);
    // The range is half open, so the date line itself is always reported as -180.
    expect(normalizeLon(540)).toBeCloseTo(-180, 10);
    expect(normalizeLon(180)).toBeCloseTo(-180, 10);
    expect(normalizeLon(0)).toBe(0);
  });

  it('clamps latitude at the poles', () => {
    expect(clampLat(120)).toBe(90);
    expect(clampLat(-120)).toBe(-90);
    expect(clampLat(45)).toBe(45);
  });

  it('converts altitudes in kilometres to globe radii', () => {
    expect(kmToRadius(0)).toBe(1);
    expect(kmToRadius(EARTH_RADIUS_KM)).toBeCloseTo(2, 10);
  });
});

describe('date line splitting', () => {
  it('leaves a path that does not cross alone', () => {
    const segments = splitAtAntimeridian([
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
    expect(segments.length).toBe(1);
    expect(segments[0].length).toBe(3);
  });

  it('breaks a crossing into two pieces that meet at the edge', () => {
    const segments = splitAtAntimeridian([
      [170, 10],
      [-170, 20],
    ]);
    expect(segments.length).toBe(2);
    const endOfFirst = segments[0][segments[0].length - 1];
    const startOfSecond = segments[1][0];
    expect(endOfFirst[0]).toBe(180);
    expect(startOfSecond[0]).toBe(-180);
    // Both ends sit at the same latitude, so the line appears continuous across the edge.
    expect(endOfFirst[1]).toBeCloseTo(startOfSecond[1], 10);
    expect(endOfFirst[1]).toBeCloseTo(15, 10);
  });

  it('handles a crossing in the other direction', () => {
    const segments = splitAtAntimeridian([
      [-175, 0],
      [175, 0],
    ]);
    expect(segments.length).toBe(2);
    expect(segments[0][segments[0].length - 1][0]).toBe(-180);
    expect(segments[1][0][0]).toBe(180);
  });
});

describe('bounds', () => {
  it('returns null with nothing to measure', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('centres on a cluster', () => {
    const bounds = boundsOf([
      { lat: 10, lon: 20 },
      { lat: 30, lon: 40 },
    ]);
    expect(bounds?.centerLat).toBeCloseTo(20, 6);
    expect(bounds?.centerLon).toBeCloseTo(30, 6);
    expect(bounds?.spanLat).toBeCloseTo(20, 6);
    expect(bounds?.spanLon).toBeCloseTo(20, 6);
  });

  it('centres correctly across the date line rather than snapping to zero', () => {
    const bounds = boundsOf([
      { lat: 0, lon: 170 },
      { lat: 0, lon: -170 },
    ]);
    expect(Math.abs(bounds?.centerLon ?? 0)).toBeCloseTo(180, 4);
    expect(bounds?.spanLon).toBeCloseTo(20, 4);
  });
});
