# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
