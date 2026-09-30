/**
 * Feature detection.
 *
 * The map is 3D when it can be and 2D when it cannot, and that decision is made here once, before
 * anything is built, so a browser without WebGL never sees a failed context creation.
 */

import { MAX_PIXEL_RATIO } from '../defaults.ts';

export interface Capabilities {
  /** A WebGL context of some version could be created. */
  webgl: boolean;
  /** WebGL 2 specifically, which the renderer prefers but does not require. */
  webgl2: boolean;
  /** Device pixel ratio, capped so a high density display does not quadruple the fill cost. */
  pixelRatio: number;
  /** The user has asked the system to minimise animation. */
  reducedMotion: boolean;
}

let webglSupport: { webgl: boolean; webgl2: boolean } | null = null;

/** Probe WebGL support once using a throwaway canvas, then remember the answer. */
export function probeWebGL(): { webgl: boolean; webgl2: boolean } {
  if (webglSupport) {
    return webglSupport;
  }
  if (typeof document === 'undefined') {
    webglSupport = { webgl: false, webgl2: false };
    return webglSupport;
  }

  let webgl = false;
  let webgl2 = false;
  try {
    const canvas = document.createElement('canvas');
    webgl2 = Boolean(canvas.getContext('webgl2'));
    webgl =
      webgl2 || Boolean(canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'));
  } catch {
    webgl = false;
    webgl2 = false;
  }

  webglSupport = { webgl, webgl2 };
  return webglSupport;
}

/** Resolve everything about the environment the map needs to know before it builds a renderer. */
export function detectCapabilities(pixelRatioSetting: number | 'auto'): Capabilities {
  const { webgl, webgl2 } = probeWebGL();
  const devicePixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const pixelRatio =
    pixelRatioSetting === 'auto'
      ? Math.min(MAX_PIXEL_RATIO, devicePixelRatio)
      : Math.max(0.5, pixelRatioSetting);

  const reducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  return { webgl, webgl2, pixelRatio, reducedMotion };
}

/** Reset the cached probe. Only used by tests. */
export function resetCapabilityCache(): void {
  webglSupport = null;
}
