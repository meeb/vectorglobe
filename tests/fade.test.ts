import { describe, expect, it } from 'vitest';
import { fadeMultiplier } from '../src/util/fade.ts';

describe('fadeMultiplier', () => {
  it('is always 1 when there is no fade', () => {
    expect(fadeMultiplier(undefined, undefined, 12345)).toBe(1);
  });

  it('is always 1 when a fade is given but has not started', () => {
    expect(fadeMultiplier({ in: 1, stay: 1, out: 1 }, undefined, 12345)).toBe(1);
  });

  it('ramps linearly from 0 to 1 over the rise', () => {
    const fade = { in: 2, stay: 1, out: 1 };
    expect(fadeMultiplier(fade, 0, 0)).toBe(0);
    expect(fadeMultiplier(fade, 0, 1000)).toBeCloseTo(0.5, 5);
    expect(fadeMultiplier(fade, 0, 2000)).toBeCloseTo(1, 5);
  });

  it('holds at 1 throughout the stay', () => {
    const fade = { in: 1, stay: 2, out: 1 };
    expect(fadeMultiplier(fade, 0, 1000)).toBe(1);
    expect(fadeMultiplier(fade, 0, 2000)).toBe(1);
    expect(fadeMultiplier(fade, 0, 2999)).toBe(1);
  });

  it('ramps linearly from 1 to 0 over the fall', () => {
    const fade = { in: 1, stay: 1, out: 2 };
    expect(fadeMultiplier(fade, 0, 2000)).toBeCloseTo(1, 5);
    expect(fadeMultiplier(fade, 0, 3000)).toBeCloseTo(0.5, 5);
    expect(fadeMultiplier(fade, 0, 4000)).toBeCloseTo(0, 5);
  });

  it('is 0 once the whole fade has run out', () => {
    const fade = { in: 1, stay: 1, out: 1 };
    expect(fadeMultiplier(fade, 0, 3000)).toBe(0);
    expect(fadeMultiplier(fade, 0, 10000)).toBe(0);
  });

  it('treats a zero-length phase as instant rather than dividing by zero', () => {
    const fade = { in: 0, stay: 1, out: 0 };
    expect(fadeMultiplier(fade, 0, 0)).toBe(1);
    expect(fadeMultiplier(fade, 0, 999)).toBe(1);
    expect(fadeMultiplier(fade, 0, 1000)).toBe(0);
  });

  it('is 0 before the fade starts, e.g. a clock that runs backwards in a test', () => {
    expect(fadeMultiplier({ in: 1, stay: 1, out: 1 }, 1000, 0)).toBe(0);
  });
});
