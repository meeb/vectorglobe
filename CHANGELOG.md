# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Fixed part of a route silently failing to render in 3D, most visible on an explicit path built from
  real tracking data: a signal gap can jump a long way in a single recorded point (a flight losing
  ADS-B coverage over an ocean and picking back up far away, say), and sampled at the usual rate that
  one jump became a single long, thin screen-space quad - which rasterizes as nothing at all on some
  GPUs, taking that stretch of the line down with it even though the data either side was fine. Every
  path builder now breaks any single sample up further whenever it would otherwise span more than a
  few degrees, regardless of how coarse the requested sampling rate is (`stepsForSpan` in `curves.ts`).
  The 2D canvas renderer was never affected - it draws straight line segments with no equivalent
  thin-quad geometry to go wrong.

## [0.6.0] - 2026-10-01

### Added

- `map.resetCamera(transition?)`, which animates back to the camera the map was constructed with -
  for a "reset view" button, without the caller needing to remember the original `config.camera`
  (`Globe.resetCamera` in `globe.ts`).
- `config.fit.padding` and `config.fit.minSpan`, making how closely `fitPoints()` frames its points
  configurable instead of a fixed 15% margin and a fixed 5 degree minimum zoom - useful for a map
  embedded small, where a short route framed with the old fixed margin left most of the view as open
  globe around a couple of dots (`Camera.altitudeForSpan`, `Globe.fitPoints`).
- `RouteSpec.label` and `RouteSpec.title`, drawn at the midpoint of the route's curve in the same tag-
  and-title layout as a point's `label`/`title` - a flight number plus the route it covers, say. Themed
  separately from point labels through the new `theme.routeLabel` and `theme.routeLabelBackground`, and
  `.vg-route-label` for a CSS override, so route and point labels can be told apart without extra markup
  (`LabelLayer` in `labels.ts`).

### Fixed

- `fitPoints()` now fits each axis against its own field of view instead of taking the larger of the
  latitude and longitude span and fitting that against the (vertical) one alone - a wide container has
  a wider horizontal field of view than vertical, so an east-west route in one did not need pulling
  back as far as the same span would if it ran north-south (`Globe.fitPoints` in `globe.ts`).
- Fixed two-finger pinch-to-zoom on touch devices feeling very insensitive. It mapped the ratio
  between a pinch gesture's start and end finger distance directly onto the zoom change, which
  matches finger movement 1:1 but reads as sluggish in practice: a comfortable pinch only spans a
  limited physical range next to how far people expect one gesture to zoom. The ratio is now raised
  to a configurable exponent (`config.zoom.pinchSensitivity`, default 2.6) before being applied, so
  the same pinch produces a noticeably larger zoom change. Verified the amplification math and its
  live configurability end to end through the public API; this one could not be confirmed by feel on
  real touch hardware the way the mouse-based fixes in 0.5.0 were (`Controls` in `controls.ts`).

## [0.5.0] - 2026-09-30

### Fixed

- Antarctica no longer draws a spurious border line running from its coast to the globe's centre and
  back. Natural Earth's own source ring closes itself near the pole in two parts - a sweep across
  every longitude at ~constant latitude, then a climb back up to real coastline along the
  antimeridian - both now excluded from border and coastline strokes (`buildBorderPaths` in
  `landmesh.ts`); the land fill was never affected.
- Fixed small diamond-shaped gaps appearing in the 3D land fill on complex, heavily subdivided
  coastlines (most visible on Antarctica and Russia): the water sphere and land layer sat only
  0.0005 globe radii apart, too close for the depth buffer to reliably resolve on some hardware, so
  thin slivers of land would lose the depth test and show water through. Land now keeps a 0.002
  radius step above water - enough headroom to fix it with margin.
- Fixed borders, the graticule, points and routes appearing visibly offset from the land fill they
  trace, worst near the horizon at a tilted camera angle. The first attempt at the depth-gap fix
  above widened every layer's radius step uniformly, which fixed the water/land case but left borders
  floating 0.004 radii above the fill they outline - enough to misalign visibly under perspective.
  Only land and water write to the depth buffer and need a wide gap to survive a mutual comparison;
  the stroke and dot layers above land only face a one-sided test and need much less, so they now
  keep a small, fixed step above land instead of matching its gap from water
  (`LAYER_RADIUS` in `renderer.ts`).
- Fixed mouse wheel (and the +/- keys) zoom feeling over-sensitive, in two parts:
  - `camera.altitude` is measured from the globe's centre, so it is 1 at the surface itself;
    `zoomBy` was scaling that raw value, which scales the actual height above the surface
    (`altitude - 1`) far more aggressively the closer that height already is to zero. A wheel notch
    that trimmed ~15% off your height when zoomed out was cutting well over 100% off it near the
    minimum zoom. `zoomBy` now scales the height directly, so one notch is the same relative step
    at any distance (`Camera.zoomBy` in `camera.ts`).
  - That alone made close and far zoom feel *the same* as each other, but both were still using the
    same brisk rate a normal scroll gesture already compounds quickly at any distance - five notches
    doubled your height, ten quadrupled it - so close zoom not standing out anymore didn't read as
    an improvement. The default per-notch rate is now gentler (five notches is roughly a 40% change
    instead of 100%), and it is exposed as `config.zoom.speed` so it can be tuned further without a
    code change (`types.ts`, `defaults.ts`, `Controls` in `controls.ts`).
- Fixed click-and-drag rotation being dramatically over-sensitive at close zoom - a drag of a few
  percent of the window width could sweep the entire visible area several times over, flinging
  anything near the edge off-screen. The per-pixel rotation was based on the angular size of the
  *globe itself* as seen from the eye, an unrelated quantity that happened to track reasonably well
  zoomed out but diverged sharply close in. It is now derived directly from the perspective
  projection, so the point under the cursor at the start of a drag stays under the cursor - the
  direct-manipulation feel of "grab the globe and turn it" - at any zoom (`dragScale` in `globe.ts`).

### Changed

- Embedded world borders moved from Natural Earth 1:110m to 1:50m (`make sync SIMPLIFY=20` by
  default) - individually recognisable islands and coastlines instead of the faceted 1:110m shapes,
  at roughly 75KB of embedded data instead of 20KB. The bundle size budget was raised from
  110KB/45KB to 155KB/90KB (minified/gzipped) to match; the actual build sits at about 143KB/80KB.

## [0.1.0]

First release.

### Added

- 3D globe renderer built directly on WebGL, with no runtime dependencies: shaded sphere, filled
  countries, shared-arc borders, screen-space line widths, camera-facing dots and an atmospheric rim.
- 2D equirectangular renderer, used automatically where WebGL is unavailable or the context is lost,
  with Mercator available as an option.
- Pan, rotate, tilt and zoom by pointer, touch and keyboard, plus optional idle rotation and animated
  camera moves through `flyTo()` and `fitPoints()`.
- Labelled dots, and routes either generated as a great circle arc between two dots or followed from an
  explicit path of coordinates with altitudes.
- Themeable colours and configuration, changeable at runtime.
- Natural Earth 1:110m borders embedded in the bundle, refreshed with `make sync`.
