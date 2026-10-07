/**
 * Default theme and configuration.
 *
 * The defaults are a dark, low contrast palette that suits a route map: the land reads as a solid
 * mass, the borders are just visible, and dots and routes are the brightest things on screen.
 */

import type { GlobeConfig, Theme } from './types.ts';

export const DEFAULT_THEME: Theme = {
  background: 'transparent',
  water: '#0b1726',
  land: '#1d3346',
  border: '#33536e',
  coastline: '#4a6d8c',
  graticule: 'rgba(255, 255, 255, 0.07)',
  atmosphere: '#4a90d9',
  point: '#ffb347',
  pointLabel: '#e8eef4',
  pointLabelBackground: 'rgba(8, 16, 26, 0.72)',
  route: '#4fc3f7',
  routeLabel: '#e8eef4',
  routeLabelBackground: 'rgba(8, 16, 26, 0.72)',
};

export const DEFAULT_CONFIG: GlobeConfig = {
  mode: 'auto',
  camera: { lat: 20, lon: 0, altitude: 2.5, tilt: 0, bearing: 0 },
  zoom: { min: 1.15, max: 8, speed: 1.07, pinchSensitivity: 2.6 },
  fit: { padding: 1.15, minSpan: 5 },
  interactive: true,
  autoRotate: { enabled: false, speed: 3, pauseOnInteract: true, resumeAfter: 4000 },
  graticule: { enabled: false, step: 15, width: 1 },
  // 764.52km reproduces the fixed 1.12x globe-radius shell this used to be hardcoded to.
  atmosphere: { enabled: true, strength: 1, height: 764.52 },
  labels: { enabled: true, collide: true, offset: 8 },
  borders: { enabled: true, width: 1 },
  land: { enabled: true },
  routes: { segments: 64, arcHeight: 0.35, autoHeight: false, width: 1.5 },
  points: { size: 4 },
  projection: 'equirectangular',
  pixelRatio: 'auto',
  antialias: true,
  sphereSegments: 64,
  shading: 0.45,
};

/** Highest device pixel ratio honoured, above which the cost outweighs the visible gain. */
export const MAX_PIXEL_RATIO = 2;

/** Vertical field of view of the 3D camera, in radians. */
export const FIELD_OF_VIEW = (45 * Math.PI) / 180;
