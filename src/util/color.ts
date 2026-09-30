/**
 * Colour parsing.
 *
 * Themes accept any CSS colour string, but the WebGL renderer needs normalised components and the 2D
 * renderer needs to re-apply per feature opacity, so everything is parsed once into RGBA floats.
 */

/** Red, green, blue and alpha, each 0 to 1. */
export type RGBA = [number, number, number, number];

const NAMED: Record<string, string> = {
  transparent: '#00000000',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  orange: '#ffa500',
  grey: '#808080',
  gray: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
  purple: '#800080',
  lime: '#00ff00',
};

const cache = new Map<string, RGBA>();
let warned = false;

function parseHex(hex: string): RGBA | null {
  const value = hex.slice(1);
  const expand = (c: string): number => Number.parseInt(c + c, 16) / 255;
  const pair = (i: number): number => Number.parseInt(value.slice(i, i + 2), 16) / 255;

  if (value.length === 3 || value.length === 4) {
    return [
      expand(value[0]),
      expand(value[1]),
      expand(value[2]),
      value.length === 4 ? expand(value[3]) : 1,
    ];
  }
  if (value.length === 6 || value.length === 8) {
    return [pair(0), pair(2), pair(4), value.length === 8 ? pair(6) : 1];
  }
  return null;
}

interface Component {
  value: number;
  percent: boolean;
}

function parseComponents(input: string): Component[] {
  return input
    .slice(input.indexOf('(') + 1, input.lastIndexOf(')'))
    .split(/[\s,/]+/)
    .filter((part) => part.length > 0)
    .map((part) => ({ value: Number.parseFloat(part), percent: part.endsWith('%') }));
}

/** A colour channel is either a percentage of full scale or a 0-255 number. */
function channelValue(component: Component): number {
  return component.percent ? component.value / 100 : component.value / 255;
}

/** Alpha is either a percentage or already a 0-1 fraction. */
function alphaValue(component: Component | undefined): number {
  if (!component) {
    return 1;
  }
  return component.percent ? component.value / 100 : component.value;
}

function hueToChannel(p: number, q: number, tRaw: number): number {
  let t = tRaw;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/**
 * Parse a CSS colour string into normalised RGBA.
 *
 * Hex, rgb(), rgba(), hsl(), hsla() and the common colour names are handled directly. Anything else
 * is resolved through the browser when one is available, and falls back to opaque black otherwise.
 */
export function parseColor(input: string): RGBA {
  const key = input.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  let result: RGBA | null = null;
  const named = NAMED[key];
  const value = named ?? key;

  if (value.startsWith('#')) {
    result = parseHex(value);
  } else if (value.startsWith('rgb')) {
    const parts = parseComponents(value);
    if (parts.length >= 3) {
      result = [
        channelValue(parts[0]),
        channelValue(parts[1]),
        channelValue(parts[2]),
        alphaValue(parts[3]),
      ];
    }
  } else if (value.startsWith('hsl')) {
    const parts = parseComponents(value);
    if (parts.length >= 3) {
      const h = (((parts[0].value % 360) + 360) % 360) / 360;
      const s = parts[1].percent ? parts[1].value / 100 : parts[1].value;
      const l = parts[2].percent ? parts[2].value / 100 : parts[2].value;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      result = [
        hueToChannel(p, q, h + 1 / 3),
        hueToChannel(p, q, h),
        hueToChannel(p, q, h - 1 / 3),
        alphaValue(parts[3]),
      ];
    }
  }

  if (!result && typeof document !== 'undefined') {
    result = resolveViaCanvas(value);
  }

  if (!result) {
    if (!warned) {
      warned = true;
      console.warn(`vectorglobe: could not parse colour "${input}", falling back to black`);
    }
    result = [0, 0, 0, 1];
  }

  const clamped: RGBA = [
    Math.min(1, Math.max(0, result[0])),
    Math.min(1, Math.max(0, result[1])),
    Math.min(1, Math.max(0, result[2])),
    Math.min(1, Math.max(0, result[3])),
  ];
  cache.set(key, clamped);
  return clamped;
}

/** Let the browser resolve exotic colour syntax such as colour names we do not carry a table for. */
function resolveViaCanvas(value: string): RGBA | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return null;
    }
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = '#000000';
    context.fillStyle = value;
    // An unparseable value leaves fillStyle untouched, which reads back as the black we just set.
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0] / 255, data[1] / 255, data[2] / 255, data[3] / 255];
  } catch {
    return null;
  }
}

/** Format normalised RGBA as a CSS string, optionally scaling the alpha. */
export function toCssRgba(color: RGBA, opacity = 1): string {
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);
  return `rgba(${r}, ${g}, ${b}, ${(color[3] * opacity).toFixed(3)})`;
}

/** Multiply a colour's alpha, used to apply per feature opacity on top of a theme colour. */
export function withOpacity(color: RGBA, opacity: number): RGBA {
  return [color[0], color[1], color[2], color[3] * opacity];
}
