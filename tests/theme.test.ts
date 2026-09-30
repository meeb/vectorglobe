import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/defaults.ts';
import { parseColor, toCssRgba, withOpacity } from '../src/util/color.ts';
import { deepMerge } from '../src/util/merge.ts';

describe('configuration merging', () => {
  it('overrides a single nested field without losing its siblings', () => {
    const merged = deepMerge(DEFAULT_CONFIG, { graticule: { enabled: true } });
    expect(merged.graticule.enabled).toBe(true);
    expect(merged.graticule.step).toBe(DEFAULT_CONFIG.graticule.step);
    expect(merged.camera).toEqual(DEFAULT_CONFIG.camera);
  });

  it('leaves the original untouched', () => {
    const before = DEFAULT_CONFIG.graticule.enabled;
    deepMerge(DEFAULT_CONFIG, { graticule: { enabled: !before } });
    expect(DEFAULT_CONFIG.graticule.enabled).toBe(before);
  });

  it('replaces arrays rather than merging them', () => {
    expect(deepMerge({ items: [1, 2, 3] }, { items: [9] } as never).items).toEqual([9]);
  });

  it('ignores undefined so a partial object does not erase defaults', () => {
    const merged = deepMerge(DEFAULT_CONFIG, { mode: undefined });
    expect(merged.mode).toBe(DEFAULT_CONFIG.mode);
  });

  it('returns the base unchanged when there is nothing to merge', () => {
    expect(deepMerge(DEFAULT_CONFIG, undefined)).toBe(DEFAULT_CONFIG);
  });
});

describe('colour parsing', () => {
  it('reads every hex form', () => {
    expect(parseColor('#f00')).toEqual([1, 0, 0, 1]);
    expect(parseColor('#ff0000')).toEqual([1, 0, 0, 1]);
    expect(parseColor('#ff000080')[3]).toBeCloseTo(0.502, 2);
    expect(parseColor('#f008')[3]).toBeCloseTo(0.533, 2);
  });

  it('reads rgb and rgba, with numbers or percentages', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1]);
    expect(parseColor('rgb(100%, 0%, 0%)')).toEqual([1, 0, 0, 1]);
    expect(parseColor('rgba(0, 0, 255, 0.5)')).toEqual([0, 0, 1, 0.5]);
    expect(parseColor('rgb(0 128 255 / 50%)')[3]).toBeCloseTo(0.5, 5);
  });

  it('reads hsl', () => {
    const [r, g, b] = parseColor('hsl(0, 100%, 50%)');
    expect([r, g, b]).toEqual([1, 0, 0]);
    const green = parseColor('hsl(120, 100%, 50%)');
    expect(green[1]).toBeCloseTo(1, 5);
  });

  it('knows transparent and the common names', () => {
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
    expect(parseColor('white')).toEqual([1, 1, 1, 1]);
    expect(parseColor('  BLACK  ')).toEqual([0, 0, 0, 1]);
  });

  it('formats back to a CSS string and applies opacity', () => {
    expect(toCssRgba([1, 0, 0, 1])).toBe('rgba(255, 0, 0, 1.000)');
    expect(withOpacity([1, 0, 0, 0.8], 0.5)[3]).toBeCloseTo(0.4, 6);
  });
});
