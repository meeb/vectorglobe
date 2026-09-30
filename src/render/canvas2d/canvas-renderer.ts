/**
 * The 2D renderer.
 *
 * Used when WebGL is unavailable, or when the caller asks for a flat map. It draws the same scene the
 * 3D renderer does, through the 2D canvas API, with the world repeated horizontally so panning across
 * the date line is seamless.
 *
 * Geometry in longitude and latitude is built once and cached; only the projection changes as the
 * camera moves.
 */

import { getWorld, ringCoordinates, type World } from '../../data/world.ts';
import { vec3ToLonLat } from '../../math/geo.ts';
import type { Vec3 } from '../../math/vec3.ts';
import type { GlobeConfig, Mode, Theme } from '../../types.ts';
import { parseColor, toCssRgba } from '../../util/color.ts';
import type { Projected, Renderer, Scene } from '../renderer.ts';
import { FlatProjection, unwrapLongitudes } from './projection.ts';

interface CachedPolygon {
  /** Rings of interleaved lon/lat, outer ring first. */
  rings: Float32Array[];
  minLon: number;
  maxLon: number;
}

interface CachedGeometry {
  polygons: CachedPolygon[];
  borders: Float32Array[];
  coastlines: Float32Array[];
}

let cachedGeometry: CachedGeometry | null = null;

/** Build the flat geometry once and share it between every 2D map on the page. */
function flatGeometry(world: World): CachedGeometry {
  if (cachedGeometry) {
    return cachedGeometry;
  }

  const polygons: CachedPolygon[] = [];
  for (const shape of world.shapes) {
    for (const rings of shape) {
      const coordinateRings = rings.map((ring) => ringCoordinates(world.arcs, ring));
      let minLon = Number.POSITIVE_INFINITY;
      let maxLon = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < coordinateRings[0].length; i += 2) {
        minLon = Math.min(minLon, coordinateRings[0][i]);
        maxLon = Math.max(maxLon, coordinateRings[0][i]);
      }
      polygons.push({ rings: coordinateRings, minLon, maxLon });
    }
  }

  const borders: Float32Array[] = [];
  const coastlines: Float32Array[] = [];
  const arcCount = world.arcs.offsets.length - 1;
  for (let index = 0; index < arcCount; index++) {
    const start = world.arcs.offsets[index];
    const end = world.arcs.offsets[index + 1];
    if (end - start < 2) {
      continue;
    }
    const path = world.arcs.coords.subarray(start * 2, end * 2);
    if (world.arcUse[index] > 1) {
      borders.push(path);
    } else {
      coastlines.push(path);
    }
  }

  cachedGeometry = { polygons, borders, coastlines };
  return cachedGeometry;
}

export class CanvasRenderer implements Renderer {
  readonly mode: Mode = '2d';
  readonly canvas: HTMLCanvasElement;

  private context: CanvasRenderingContext2D;
  private geometry: CachedGeometry;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private projection: FlatProjection | null = null;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('vectorglobe: could not create a 2D canvas context');
    }
    this.canvas = canvas;
    this.context = context;
    this.geometry = flatGeometry(getWorld());
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.canvas.width = Math.max(1, Math.round(this.width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(this.height * pixelRatio));
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  render(scene: Scene): void {
    if (this.destroyed) {
      return;
    }

    const projection = new FlatProjection(
      this.width,
      this.height,
      scene.camera.lon,
      scene.camera.lat,
      scene.camera.altitude,
      scene.config.projection,
    );
    this.projection = projection;

    const context = this.context;
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);

    const background = parseColor(scene.theme.background);
    if (background[3] > 0) {
      context.fillStyle = toCssRgba(background);
      context.fillRect(0, 0, this.width, this.height);
    }

    const copies = projection.visibleCopies();
    this.drawWater(scene.theme, projection, copies);

    if (scene.config.land.enabled) {
      this.drawLand(scene.theme, projection, copies);
    }
    if (scene.config.graticule.enabled) {
      this.drawGraticule(scene.theme, scene.config, projection, copies);
    }
    if (scene.config.borders.enabled) {
      this.drawPaths(
        this.geometry.borders,
        scene.theme.border,
        scene.config.borders.width,
        projection,
        copies,
      );
      this.drawPaths(
        this.geometry.coastlines,
        scene.theme.coastline,
        scene.config.borders.width,
        projection,
        copies,
      );
    }

    this.drawRoutes(scene, projection, copies);
    this.drawPoints(scene, projection, copies);
  }

  project(position: Vec3, _scene: Scene): Projected {
    if (!this.projection) {
      return { x: 0, y: 0, visible: false };
    }
    const [lon, lat] = vec3ToLonLat(position);
    // Pick the copy of the world that actually falls inside the view.
    const [baseX, y] = this.projection.project(lon, lat);
    let x = baseX;
    let best = Number.POSITIVE_INFINITY;
    for (const offset of this.projection.visibleCopies()) {
      const candidate = baseX + offset;
      const distance = Math.abs(candidate - this.width / 2);
      if (distance < best) {
        best = distance;
        x = candidate;
      }
    }
    const visible = x >= 0 && x <= this.width && y >= 0 && y <= this.height;
    return { x, y, visible };
  }

  unproject(x: number, y: number, _scene: Scene): [number, number] | null {
    if (!this.projection) {
      return null;
    }
    const [lon, lat] = this.projection.unproject(x, y);
    const [top, bottom] = this.projection.verticalBounds();
    return y < top || y > bottom ? null : [lon, lat];
  }

  destroy(): void {
    this.destroyed = true;
    this.canvas.remove();
  }

  private drawWater(theme: Theme, projection: FlatProjection, copies: number[]): void {
    const water = parseColor(theme.water);
    if (water[3] <= 0) {
      return;
    }
    const [top, bottom] = projection.verticalBounds();
    const context = this.context;
    context.fillStyle = toCssRgba(water);
    for (const offset of copies) {
      const [left] = projection.project(-180, 0);
      context.fillRect(left + offset, top, projection.worldWidth, bottom - top);
    }
  }

  private drawLand(theme: Theme, projection: FlatProjection, copies: number[]): void {
    const land = parseColor(theme.land);
    if (land[3] <= 0) {
      return;
    }
    const context = this.context;
    context.fillStyle = toCssRgba(land);

    for (const offset of copies) {
      for (const polygon of this.geometry.polygons) {
        // Skip anything that this copy puts outside the container.
        const [minX] = projection.project(polygon.minLon, 0);
        const [maxX] = projection.project(polygon.maxLon, 0);
        if (maxX + offset < 0 || minX + offset > this.width) {
          continue;
        }

        context.beginPath();
        for (const ring of polygon.rings) {
          for (let i = 0; i < ring.length; i += 2) {
            const [x, y] = projection.project(ring[i], ring[i + 1]);
            if (i === 0) {
              context.moveTo(x + offset, y);
            } else {
              context.lineTo(x + offset, y);
            }
          }
          context.closePath();
        }
        // Even-odd makes the hole rings cut out of the outer ring without any extra work.
        context.fill('evenodd');
      }
    }
  }

  private drawPaths(
    paths: ArrayLike<number>[],
    color: string,
    width: number,
    projection: FlatProjection,
    copies: number[],
  ): void {
    const rgba = parseColor(color);
    if (rgba[3] <= 0 || width <= 0) {
      return;
    }
    const context = this.context;
    context.strokeStyle = toCssRgba(rgba);
    context.lineWidth = width;
    context.lineJoin = 'round';
    context.lineCap = 'round';

    for (const offset of copies) {
      context.beginPath();
      for (const path of paths) {
        for (let i = 0; i < path.length; i += 2) {
          const [x, y] = projection.project(path[i], path[i + 1]);
          if (i === 0) {
            context.moveTo(x + offset, y);
          } else {
            context.lineTo(x + offset, y);
          }
        }
      }
      context.stroke();
    }
  }

  private drawGraticule(
    theme: Theme,
    config: GlobeConfig,
    projection: FlatProjection,
    copies: number[],
  ): void {
    const rgba = parseColor(theme.graticule);
    if (rgba[3] <= 0) {
      return;
    }
    const step = Math.max(5, Math.min(45, config.graticule.step));
    const context = this.context;
    context.strokeStyle = toCssRgba(rgba);
    context.lineWidth = config.graticule.width;

    for (const offset of copies) {
      context.beginPath();
      for (let lon = -180; lon <= 180; lon += step) {
        const [x, top] = projection.project(lon, 90);
        const [, bottom] = projection.project(lon, -90);
        context.moveTo(x + offset, top);
        context.lineTo(x + offset, bottom);
      }
      for (let lat = -90 + step; lat < 90; lat += step) {
        const [left, y] = projection.project(-180, lat);
        const [right] = projection.project(180, lat);
        context.moveTo(left + offset, y);
        context.lineTo(right + offset, y);
      }
      context.stroke();
    }
  }

  private drawRoutes(scene: Scene, projection: FlatProjection, copies: number[]): void {
    const context = this.context;
    context.lineJoin = 'round';
    context.lineCap = 'round';

    for (const prepared of scene.routes) {
      const rgba = parseColor(prepared.route.color);
      if (rgba[3] <= 0) {
        continue;
      }

      // Altitude has no meaning on a flat map, so only the ground track is kept.
      const points: number[] = [];
      for (let i = 0; i < prepared.positions.length; i += 3) {
        const [lon, lat] = vec3ToLonLat([
          prepared.positions[i],
          prepared.positions[i + 1],
          prepared.positions[i + 2],
        ]);
        points.push(lon, lat);
      }
      unwrapLongitudes(points);

      context.strokeStyle = toCssRgba(rgba, prepared.route.opacity);
      context.lineWidth = prepared.route.width;
      for (const offset of copies) {
        context.beginPath();
        for (let i = 0; i < points.length; i += 2) {
          const [x, y] = projection.project(points[i], points[i + 1]);
          if (i === 0) {
            context.moveTo(x + offset, y);
          } else {
            context.lineTo(x + offset, y);
          }
        }
        context.stroke();
      }
    }
  }

  private drawPoints(scene: Scene, projection: FlatProjection, copies: number[]): void {
    const context = this.context;
    for (const point of scene.points) {
      const rgba = parseColor(point.color);
      if (rgba[3] <= 0) {
        continue;
      }
      context.fillStyle = toCssRgba(rgba, point.opacity);
      const [baseX, y] = projection.project(point.lon, point.lat);
      for (const offset of copies) {
        const x = baseX + offset;
        if (x < -point.size || x > this.width + point.size) {
          continue;
        }
        context.beginPath();
        context.arc(x, y, point.size, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
}
