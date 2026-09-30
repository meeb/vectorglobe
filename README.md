# vectorglobe

All-in-one vector world map rendering for websites. One JavaScript file, no tiles, no API keys and
nothing fetched at runtime: the country borders are compiled into the bundle.

- **3D by default**, with pan, rotate, tilt and zoom, falling back to a flat 2D map when WebGL is
  unavailable.
- **Built for route maps.** Labelled dots and two kinds of connection between them: a great circle arc
  generated from two dot ids, or an explicit path you supply in 3D.
- **Small.** About 82KB minified, 39KB gzipped, world data included.
- **No runtime dependencies.** The renderer, the maths and the geometry are all in this package.

```html
<div id="map" style="width: 100%; height: 600px"></div>
<script src="vectorglobe.min.js"></script>
<script>
  const map = VectorGlobe(document.getElementById('map'));

  map.addPoint({ id: 'LHR', lat: 51.47, lon: -0.4543, label: 'LHR', title: 'London Heathrow' });
  map.addPoint({ id: 'JFK', lat: 40.6413, lon: -73.7781, label: 'JFK', title: 'New York Kennedy' });
  map.addRoute({ id: 'LHR-JFK', from: 'LHR', to: 'JFK' });
</script>
```

## Install

```sh
npm install @meeby/vectorglobe
```

```js
import { vectorGlobe } from '@meeby/vectorglobe';

const map = vectorGlobe(container, { theme, config });
```

Or drop `dist/vectorglobe.min.js` on a page and use the `VectorGlobe` global, as above. The global is
the factory function itself, with the named exports hanging off it.

The container needs a size of its own. The map fills it and follows it as it resizes.

## Points and routes

A point is a dot with an optional short tag and a longer title:

```js
map.addPoint({
  id: 'SIN',                    // required, and how routes refer to it
  lat: 1.3644,
  lon: 103.9915,
  label: 'SIN',                 // short tag, drawn next to the dot
  title: 'Singapore Changi',    // longer name, drawn under the tag
  color: '#ffb347',             // defaults to theme.point
  size: 4,                      // radius in pixels
  opacity: 1,
  labelVisible: true,
  data: { terminal: 3 },        // anything you like, handed back in events
});
```

A route is either **generated** from two point ids, in which case the map works out the great circle
between them and bows it into an arc:

```js
map.addRoute({ id: 'SIN-LHR', from: 'SIN', to: 'LHR', color: '#4fc3f7', width: 1.5 });
```

...or **explicit**, where you give the coordinates to follow. Each point is `[lon, lat]` or
`[lon, lat, altitudeKm]`, and the curve is fitted through every one of them:

```js
map.addRoute({
  id: 'flight-714',
  path: [
    [-0.4543, 51.47, 0],        // wheels up
    [16.8, 48.1, 11.2],         // cruising at 11.2km
    [55.3, 35.2, 11.6],
    [103.9915, 1.3644, 0],      // wheels down
  ],
  curve: 'smooth',              // or 'linear' for straight hops between coordinates
  color: '#8bf7a0',
});
```

Altitude is in kilometres above sea level and is ignored by the 2D renderer, which draws the ground
track. Use `curve: 'linear'` when your coordinates are already dense enough that you want them joined
rather than smoothed.

Everything is keyed by id, so anything can be changed or removed later:

```js
map.updatePoint('SIN', { color: '#ff5252' });
map.removeRoute('SIN-LHR');
map.clearPoints();
```

## Theme

Every colour is a plain CSS colour string, and any of them can be changed at any time with
`setTheme()`. These are the defaults:

```js
const map = vectorGlobe(container, {
  theme: {
    background: 'transparent',                  // behind the globe; lets the page show through
    water: '#0b1726',
    land: '#1d3346',
    border: '#33536e',                          // borders shared by two countries
    coastline: '#4a6d8c',                       // borders that meet the sea
    graticule: 'rgba(255, 255, 255, 0.07)',
    atmosphere: '#4a90d9',                      // rim light around the globe, 3D only
    point: '#ffb347',
    pointLabel: '#e8eef4',
    pointLabelBackground: 'rgba(8, 16, 26, 0.72)',
    route: '#4fc3f7',
  },
});
```

Labels are ordinary DOM elements, so they can also be restyled from your own stylesheet through
`.vg-label`, `.vg-label-tag` and `.vg-label-title`.

A pale theme usually wants much less edge shading than the dark default, or the globe picks up a dirty
ring around its edge:

```js
map.setConfig({ shading: 0.12 });
map.setTheme({ water: '#dbe6ef', land: '#f6f8fa', border: '#b3c2ce', coastline: '#93a5b4' });
```

## Configuration

```js
const map = vectorGlobe(container, {
  config: {
    mode: 'auto',                 // 'auto' | '3d' | '2d'
    camera: { lat: 20, lon: 0, altitude: 2.5, tilt: 0, bearing: 0 },
    zoom: { min: 1.15, max: 8 },  // altitude limits, in globe radii from the centre
    interactive: true,
    autoRotate: { enabled: false, speed: 3, pauseOnInteract: true, resumeAfter: 4000 },
    graticule: { enabled: false, step: 15, width: 1 },
    atmosphere: { enabled: true, strength: 1 },
    labels: { enabled: true, collide: true, offset: 8 },
    borders: { enabled: true, width: 1 },
    land: { enabled: true },
    routes: { segments: 64, arcHeight: 0.35, width: 1.5 },
    points: { size: 4 },
    projection: 'equirectangular',  // 2D only; 'mercator' is also available
    pixelRatio: 'auto',
    antialias: true,
    sphereSegments: 64,
    shading: 0.45,                  // how much the globe darkens towards its edge
  },
});
```

`camera.altitude` is the distance from the centre of the globe in globe radii, so `1` is ground level
and larger numbers are further away. `tilt` pitches the view away from looking straight down, up to 80
degrees, and `bearing` spins it around the local vertical. In 2D, `lat` and `lon` are the centre of the
view, `altitude` is the zoom, and `tilt` and `bearing` are ignored.

Only the fields you pass are overridden; everything nested is merged, so
`setConfig({ graticule: { enabled: true } })` leaves `graticule.step` alone.

## Camera

```js
map.setCamera({ lat: 35.77, lon: 140.39 }, { animate: true, duration: 900 });
map.flyTo('NRT', { duration: 1200 });     // a point id, or a camera object
map.fitPoints(['LHR', 'JFK', 'SIN']);     // frame these points, or all of them if omitted
map.getCamera();                          // { lat, lon, altitude, tilt, bearing }
```

Camera animations are skipped for anyone whose system asks for reduced motion.

## Events

```js
map.on('ready', ({ mode }) => console.log('rendering in', mode));
map.on('click', ({ target, lat, lon }) => {
  if (target?.kind === 'point') {
    console.log('clicked', target.point.title);
  }
});
map.on('hover', ({ target }) => { /* target is null over empty space */ });
map.on('camerachange', ({ camera }) => {});
map.on('modechange', ({ mode, reason }) => {});  // e.g. the WebGL context was lost
map.on('error', ({ error }) => {});
```

`lat` and `lon` are the position under the pointer, or `null` when the pointer is off the globe.

## Interaction

| Gesture | Effect |
| --- | --- |
| Drag | Spin the globe, or pan the flat map |
| Shift drag, right drag | Tilt and turn |
| Wheel, pinch | Zoom |
| Arrow keys | Spin, with shift to tilt and turn |
| Plus, minus | Zoom |

Set `config.interactive: false` to turn all of it off and drive the camera from your own code.

## 2D fallback

If WebGL cannot be used, the map renders a flat equirectangular world instead, with the same points,
routes, labels and events, and the same pan and zoom gestures. Nothing in the API changes; `map.mode`
tells you which renderer is in use, and `modechange` fires if the map has to switch, which also happens
when the GPU drops the WebGL context. Force either renderer with `config.mode`.

## Map data

Borders come from [Natural Earth](https://www.naturalearthdata.com/) 1:110m admin 0 countries, via the
[natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) repository at a pinned release.
The sync pipeline simplifies the geometry, builds a topology so a border shared by two countries is
stored once, quantises the coordinates onto a 16 bit grid and encodes the result as delta varints. That
is what turns 839KB of GeoJSON into roughly 20KB of embedded data.

Natural Earth is in the public domain. `VectorGlobe.worldData` carries the provenance of the embedded
copy, including the source release and its checksum, for attribution.

The resolution is deliberately low. It is chosen for plotting routes at global scale rather than for
cartographic accuracy, and coastlines will not hold up at city level zoom.

To refresh it, or to trade size against detail:

```sh
make sync                 # re-download and re-encode at the default 35% simplification
make sync SIMPLIFY=60     # keep more vertices, at the cost of a larger bundle
```

## Development

```sh
make install     # install dependencies
make dev         # watch, rebuild and serve the demo on http://localhost:8080
make test        # run the test suite
make lint        # check formatting and lint rules
make format      # rewrite sources with the canonical formatting
make typecheck   # type check without emitting
make build       # build dist/ and report the bundle sizes
make size        # report sizes against the budget
make sync        # refresh the embedded world data
make release     # every check, then preview the published package
```

`make dev` serves `examples/index.html`, which is both the demo and the manual test harness: it has
controls for switching renderer, toggling the graticule, atmosphere, labels and idle rotation, and
swapping between three themes.

## Releasing

Publishing to npm runs through [`.github/workflows/release.yml`](.github/workflows/release.yml) and
uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): GitHub Actions authenticates
to npm via OIDC, so there is no `NPM_TOKEN` secret sitting in the repo. It fires on every `vX.Y.Z` tag
push, checks the tag against `package.json`, runs the full gate (lint, typecheck, test, build, size
budget), publishes, then records the release on GitHub - all inside the workflow, nothing to install
or click locally.

```sh
npm version minor              # bump package.json and package-lock.json, commit, tag v0.2.0
git push --follow-tags         # pushing the tag is what triggers the workflow
```

That's the entire release. Watch it run under the repo's Actions tab.

### One-time setup

1. **First publish, by hand.** npm's trusted-publisher settings only exist for a package that is
   already on the registry, so the very first release can't go through CI:
   ```sh
   npm login
   npm run build
   npm publish --access public
   ```
2. **Configure the trusted publisher.** On the
   [package's settings page](https://www.npmjs.com/package/@meeby/vectorglobe/access) on npmjs.com, add a
   GitHub Actions trusted publisher: organization/user `meeb`, repository `vectorglobe`, workflow
   filename `release.yml`, environment `npm-publish`.
3. From then on, `npm publish` from a laptop is no longer needed — every release goes through the
   workflow above.

### Version support

Every release intentionally supports two moving targets, both worth watching for drift on a repository
this long-lived: Node.js LTS versions come and go (`engines.node` and the CI matrix should track
current LTS lines rather than pin to one that has aged out), and npm's own requirements for trusted
publishing (currently npm 11.5.1+, which `release.yml` installs explicitly since the npm bundled with a
given Node release is often older) can rise over time. Check both when a release starts failing for no
code-related reason.

## Browser support

Verified with headless [Playwright](https://playwright.dev/) runs of the built `dist/vectorglobe.min.js`
against current Chromium, Firefox and WebKit (Safari's engine): each one constructs the map, exercises
the full API (points, both route types, theme/config changes, camera moves, a forced 3D-to-2D switch),
and renders correctly with zero console or page errors. That is real per-engine evidence, not an
inference from build settings — but it is evidence for *current* browsers, not for how old a release
this still works on; the four points below are, so take them as an informed floor rather than a
tested one.

- **3D needs any WebGL, not specifically WebGL2.** The renderer prefers a WebGL2 context and falls
  back to WebGL1 (`src/render/webgl/context.ts`), and either is enough to select 3D mode
  (`src/core/globe.ts`). WebGL1 has been in every major browser since roughly 2014; WebGL2 is the
  more recent floor and is what determines the numbers below.
- **The build enforces a JS syntax ceiling**, not a tested version: `scripts/build.ts`'s esbuild
  `target` (`es2020`, `chrome80`, `firefox78`, `safari15`, `edge88`) makes the build itself fail if
  the source ever uses syntax older engines can't parse. That is mechanically real, but it says
  nothing about the Web APIs actually called at runtime (`ResizeObserver`, `PointerEvent` and
  `setPointerCapture`, `matchMedia`, `queueMicrotask`, `getContext('webgl2'|'webgl')`), which were not
  independently audited against those specific old versions.
- **Safari 15 is the one number with a specific, checkable reason**: that's the release where Safari
  enabled WebGL2 by default ([caniuse](https://caniuse.com/webgl2)). It is not the oldest Safari that
  renders a globe at all - just the oldest one that gets the WebGL2 path rather than the WebGL1
  fallback.
- **Edge isn't independently tested**; from Edge 79 onward it shares Chromium and V8 with Chrome, so
  Chromium coverage is a reasonable proxy, not a substitute.

Anything without WebGL at all gets the 2D canvas renderer instead, which has no WebGL dependency and a
much older real floor.

## Licence

MIT. See [LICENSE](LICENSE).
