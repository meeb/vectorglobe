import { describe, expect, it } from 'vitest';
import {
  decodeArcs,
  decodeShapes,
  encodeArcs,
  encodeShapes,
  resolveArcRef,
  WORLD_GRID,
} from '../src/data/codec.ts';
import { WORLD_META } from '../src/data/world.generated.ts';
import { getWorld, ringCoordinates } from '../src/data/world.ts';

/** Largest error quantisation can introduce, in degrees of longitude. */
const TOLERANCE = 360 / (WORLD_GRID - 1);

describe('arc codec', () => {
  it('round trips coordinates within the quantisation step', () => {
    const arcs = [
      [
        [-180, -90],
        [0, 0],
        [179.9, 83.6],
      ],
      [
        [12.34, -45.67],
        [12.4, -45.6],
      ],
    ];

    const decoded = decodeArcs(encodeArcs(arcs));
    expect(decoded.offsets.length).toBe(3);

    let index = 0;
    for (const arc of arcs) {
      for (const [lon, lat] of arc) {
        expect(decoded.coords[index * 2]).toBeCloseTo(lon, 2);
        expect(decoded.coords[index * 2 + 1]).toBeCloseTo(lat, 2);
        index++;
      }
    }
  });

  it('keeps every arc even when quantisation collapses its points', () => {
    // Both points land on the same grid cell, but the arc must not disappear or indices would shift.
    const encoded = encodeArcs([
      [
        [0, 0],
        [0.000001, 0.000001],
      ],
      [
        [10, 10],
        [20, 20],
      ],
    ]);
    const decoded = decodeArcs(encoded);
    expect(decoded.offsets.length - 1).toBe(2);
    expect(decoded.offsets[1] - decoded.offsets[0]).toBe(1);
  });

  it('never drifts by more than one grid step', () => {
    const arc: number[][] = [];
    for (let i = 0; i < 500; i++) {
      arc.push([-180 + i * 0.72, -90 + i * 0.36]);
    }
    const decoded = decodeArcs(encodeArcs([arc]));
    for (let i = 0; i < arc.length; i++) {
      expect(Math.abs(decoded.coords[i * 2] - arc[i][0])).toBeLessThan(TOLERANCE);
      expect(Math.abs(decoded.coords[i * 2 + 1] - arc[i][1])).toBeLessThan(TOLERANCE);
    }
  });

  it('rejects a payload written by a different format version', () => {
    // Version 9 with no further content.
    expect(() => decodeArcs(btoa(String.fromCharCode(9)))).toThrow(
      /unsupported world data version/,
    );
  });
});

describe('shape codec', () => {
  it('round trips nested rings including reversed arc references', () => {
    const shapes = [[[[0, 1, ~2]], [[3, ~4]]], [[[5]]]];
    expect(decodeShapes(encodeShapes(shapes))).toEqual(shapes);
  });

  it('resolves reference direction', () => {
    expect(resolveArcRef(4)).toEqual({ index: 4, reversed: false });
    expect(resolveArcRef(~4)).toEqual({ index: 4, reversed: true });
  });
});

describe('embedded world data', () => {
  const world = getWorld();

  it('matches the metadata written by the sync pipeline', () => {
    expect(world.arcs.offsets.length - 1).toBe(WORLD_META.arcs);
    expect(world.countries.length).toBe(WORLD_META.countries);
    expect(world.shapes.length).toBe(WORLD_META.countries);
  });

  it('stays inside the bounds of the world', () => {
    for (let i = 0; i < world.arcs.coords.length; i += 2) {
      expect(world.arcs.coords[i]).toBeGreaterThanOrEqual(-180.001);
      expect(world.arcs.coords[i]).toBeLessThanOrEqual(180.001);
      expect(world.arcs.coords[i + 1]).toBeGreaterThanOrEqual(-90.001);
      expect(world.arcs.coords[i + 1]).toBeLessThanOrEqual(90.001);
    }
  });

  it('shares every border arc between the countries either side of it', () => {
    // Arcs used once are coastlines, and anything unused would mean the shape table is broken.
    expect(Array.from(world.arcUse).every((use) => use >= 1)).toBe(true);
    expect(Array.from(world.arcUse).some((use) => use > 1)).toBe(true);
  });

  it('identifies countries by name and ISO code', () => {
    const france = world.countries.find((country) => country.name === 'France');
    expect(france).toMatchObject({ iso2: 'FR', iso3: 'FRA', continent: 'Europe' });
  });

  it('builds closed rings from arc references', () => {
    for (const polygons of world.shapes) {
      for (const rings of polygons) {
        for (const ring of rings) {
          const coords = ringCoordinates(world.arcs, ring);
          expect(coords.length).toBeGreaterThanOrEqual(8);
          expect(coords[0]).toBeCloseTo(coords[coords.length - 2], 5);
          expect(coords[1]).toBeCloseTo(coords[coords.length - 1], 5);
        }
      }
    }
  });
});
