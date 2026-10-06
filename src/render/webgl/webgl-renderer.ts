/**
 * The 3D renderer.
 *
 * Draw order matters and is deliberate: the globe first to lay down depth, then land, grid, borders,
 * routes and dots on top of it, and finally the atmosphere, which is additive and reads the depth
 * buffer so the globe hides the half of the shell behind it.
 *
 * Everything on the surface is depth tested against the globe, which is what makes dots and routes on
 * the far side disappear without any explicit visibility work.
 */

import { getWorld } from '../../data/world.ts';
import { FIELD_OF_VIEW } from '../../defaults.ts';
import { buildGraticule } from '../../geometry/graticule.ts';
import { buildBorderPaths, buildLandMesh } from '../../geometry/landmesh.ts';
import { buildLineVertices, LINE_STRIDE } from '../../geometry/lines.ts';
import { buildSphere } from '../../geometry/sphere.ts';
import { lonLatToVec3, vec3ToLonLat } from '../../math/geo.ts';
import { type Mat4, transformPoint } from '../../math/mat4.ts';
import { cross, dot, normalize, sub, type Vec3 } from '../../math/vec3.ts';
import type { Mode, ResolvedFade } from '../../types.ts';
import { parseColor } from '../../util/color.ts';
import { fadeMultiplier } from '../../util/fade.ts';
import { LAYER_RADIUS, type Projected, type Renderer, type Scene } from '../renderer.ts';
import { createContext, deleteBuffer, uploadBuffer, type VertexBuffer } from './context.ts';
import { Program } from './program.ts';
import {
  ATMOSPHERE_FRAGMENT,
  ATMOSPHERE_VERTEX,
  DOT_FRAGMENT,
  DOT_VERTEX,
  LINE_FRAGMENT,
  LINE_VERTEX,
  SURFACE_FRAGMENT,
  SURFACE_VERTEX,
} from './shaders.ts';

/**
 * Floats per dot vertex: centre, quad corner, colour, size, fade (start, in, stay, out).
 *
 * A fade is baked into the buffer as data rather than recomputed on the CPU each frame, since every
 * dot shares one buffer and rebuilding it every frame to animate opacity would cost as much as
 * rebuilding it for an actual change to the point set - the one rebuild this renderer otherwise goes
 * out of its way to avoid. The shader derives live opacity from this plus a single `uTime` uniform
 * instead, so a fade animates smoothly between real rebuilds at no added per-frame CPU or GPU cost
 * beyond that one uniform upload. See `fadeMultiplier` in `shaders.ts`, which mirrors `util/fade.ts`.
 */
const DOT_STRIDE = 14;

/** Radius of the atmosphere shell, as a multiple of the globe radius. */
const ATMOSPHERE_RADIUS = 1.12;

/** No fade: the shader is told to just use the colour's own alpha, unanimated. */
const NO_FADE = -1;

interface RouteBatch {
  buffer: VertexBuffer;
  rgb: [number, number, number];
  /** Colour's own alpha, before `opacity` or any fade. */
  alpha: number;
  opacity: number;
  fade?: ResolvedFade;
  fadeStart?: number;
  width: number;
}

export class WebGLRenderer implements Renderer {
  readonly mode: Mode = '3d';
  readonly canvas: HTMLCanvasElement;

  private gl: WebGLRenderingContext;
  private surface: Program;
  private line: Program;
  private dots: Program;
  private atmosphere: Program;

  private sphereBuffer: VertexBuffer | null = null;
  private atmosphereBuffer: VertexBuffer | null = null;
  private landBuffer: VertexBuffer | null = null;
  private borderBuffer: VertexBuffer | null = null;
  private coastlineBuffer: VertexBuffer | null = null;
  private graticuleBuffer: VertexBuffer | null = null;
  private dotBuffer: VertexBuffer | null = null;
  private routeBatches: RouteBatch[] = [];

  private builtGraticuleStep = -1;
  private builtSphereSegments = -1;
  private builtPointsRevision = -1;
  private builtRoutesRevision = -1;
  private builtStyleRevision = -1;

  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private viewProjection: Mat4 | null = null;
  private eye: Vec3 = [0, 0, 1];
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, antialias: boolean) {
    const context = createContext(canvas, antialias);
    if (!context) {
      throw new Error('vectorglobe: WebGL is not available');
    }
    this.canvas = canvas;
    this.gl = context.gl;

    this.surface = new Program(this.gl, SURFACE_VERTEX, SURFACE_FRAGMENT, 'surface');
    this.line = new Program(this.gl, LINE_VERTEX, LINE_FRAGMENT, 'line');
    this.dots = new Program(this.gl, DOT_VERTEX, DOT_FRAGMENT, 'dot');
    this.atmosphere = new Program(this.gl, ATMOSPHERE_VERTEX, ATMOSPHERE_FRAGMENT, 'atmosphere');

    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.canvas.width = Math.max(1, Math.round(this.width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(this.height * pixelRatio));
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(scene: Scene): void {
    if (this.destroyed || this.gl.isContextLost()) {
      return;
    }

    this.syncWorldGeometry(scene);
    this.syncRoutes(scene);
    this.syncPoints(scene);
    this.resetAttributes();

    const gl = this.gl;
    const aspect = this.width / this.height;
    const { matrix, eye } = scene.camera.viewProjection(aspect);
    this.viewProjection = matrix;
    this.eye = eye;

    const background = parseColor(scene.theme.background);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(
      background[0] * background[3],
      background[1] * background[3],
      background[2] * background[3],
      background[3],
    );
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const eyeDirection = normalize(eye);
    // Half the drawing buffer in pixels, which is the scale the shaders use to convert a pixel width
    // into a normalised device offset.
    const halfViewport: [number, number] = [this.canvas.width / 2, this.canvas.height / 2];

    const shading = Math.max(0, Math.min(1, scene.config.shading));
    this.drawSurface(this.sphereBuffer, scene.theme.water, eyeDirection, shading);
    if (scene.config.land.enabled) {
      // Land is shaded a little less than the water, so the coastline stays readable at the limb.
      this.drawSurface(this.landBuffer, scene.theme.land, eyeDirection, shading * 0.78);
    }

    if (scene.config.graticule.enabled) {
      this.drawLines(
        this.graticuleBuffer,
        scene.theme.graticule,
        scene.config.graticule.width,
        halfViewport,
        1,
      );
    }
    if (scene.config.borders.enabled) {
      this.drawLines(
        this.borderBuffer,
        scene.theme.border,
        scene.config.borders.width,
        halfViewport,
        1,
      );
      this.drawLines(
        this.coastlineBuffer,
        scene.theme.coastline,
        scene.config.borders.width,
        halfViewport,
        1,
      );
    }

    for (const batch of this.routeBatches) {
      this.drawLineBatch(batch, halfViewport, scene.time);
    }

    this.drawDots(halfViewport, scene.time, eye);

    if (scene.config.atmosphere.enabled) {
      this.drawAtmosphere(scene.theme.atmosphere, scene.config.atmosphere.strength, eye);
    }
  }

  project(position: Vec3, scene: Scene): Projected {
    const matrix =
      this.viewProjection ?? scene.camera.viewProjection(this.width / this.height).matrix;
    const eye = this.viewProjection
      ? this.eye
      : scene.camera.viewProjection(this.width / this.height).eye;
    const clip = transformPoint(matrix, position[0], position[1], position[2]);

    if (clip[3] <= 0) {
      return { x: 0, y: 0, visible: false };
    }

    const x = ((clip[0] / clip[3]) * 0.5 + 0.5) * this.width;
    const y = (0.5 - (clip[1] / clip[3]) * 0.5) * this.height;

    // Everything the eye can see of a unit sphere lies on the far side of the horizon plane
    // dot(X, eye) = 1, so that single test is an exact visibility check for anything on or above the
    // surface, with no need to read back the depth buffer.
    const occluded = dot(position, eye) < 1;
    const inside = x >= 0 && x <= this.width && y >= 0 && y <= this.height;
    return { x, y, visible: inside && !occluded };
  }

  unproject(x: number, y: number, scene: Scene): [number, number] | null {
    const aspect = this.width / this.height;
    const { eye } = scene.camera.viewProjection(aspect);
    const view = scene.camera.view();

    // Rebuild the ray through the pixel from the camera basis rather than inverting the matrix.
    const forward = normalize(sub(view.target, view.eye));
    const right = normalize(cross(forward, view.up));
    const trueUp = cross(right, forward);

    const ndcX = (x / this.width) * 2 - 1;
    const ndcY = 1 - (y / this.height) * 2;
    const tanHalf = Math.tan(FIELD_OF_VIEW / 2);
    const direction = normalize([
      forward[0] + right[0] * ndcX * tanHalf * aspect + trueUp[0] * ndcY * tanHalf,
      forward[1] + right[1] * ndcX * tanHalf * aspect + trueUp[1] * ndcY * tanHalf,
      forward[2] + right[2] * ndcX * tanHalf * aspect + trueUp[2] * ndcY * tanHalf,
    ]);

    // Intersect with the unit sphere; the nearer root is the visible surface.
    const b = 2 * dot(eye, direction);
    const c = dot(eye, eye) - 1;
    const discriminant = b * b - 4 * c;
    if (discriminant < 0) {
      return null;
    }
    const t = (-b - Math.sqrt(discriminant)) / 2;
    if (t < 0) {
      return null;
    }

    const hit: Vec3 = [
      eye[0] + direction[0] * t,
      eye[1] + direction[1] * t,
      eye[2] + direction[2] * t,
    ];
    return vec3ToLonLat(hit);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    const gl = this.gl;
    for (const buffer of [
      this.sphereBuffer,
      this.atmosphereBuffer,
      this.landBuffer,
      this.borderBuffer,
      this.coastlineBuffer,
      this.graticuleBuffer,
      this.dotBuffer,
    ]) {
      deleteBuffer(gl, buffer);
    }
    for (const batch of this.routeBatches) {
      gl.deleteBuffer(batch.buffer.buffer);
    }
    this.routeBatches = [];
    this.surface.destroy();
    this.line.destroy();
    this.dots.destroy();
    this.atmosphere.destroy();
    this.canvas.remove();
  }

  /** Rebuild the parts of the scene that come from the embedded world data. */
  private syncWorldGeometry(scene: Scene): void {
    const gl = this.gl;

    if (this.builtSphereSegments !== scene.config.sphereSegments) {
      this.builtSphereSegments = scene.config.sphereSegments;
      this.sphereBuffer = uploadBuffer(
        gl,
        this.sphereBuffer,
        buildSphere(LAYER_RADIUS.globe, scene.config.sphereSegments),
        3,
      );
      this.atmosphereBuffer = uploadBuffer(
        gl,
        this.atmosphereBuffer,
        buildSphere(ATMOSPHERE_RADIUS, scene.config.sphereSegments),
        3,
      );
    }

    if (!this.landBuffer && !this.borderBuffer) {
      const world = getWorld();
      this.landBuffer = uploadBuffer(gl, null, buildLandMesh(world, LAYER_RADIUS.land), 3);
      const { borders, coastlines } = buildBorderPaths(world, LAYER_RADIUS.border);
      this.borderBuffer = uploadBuffer(gl, null, buildLineVertices(borders), LINE_STRIDE);
      this.coastlineBuffer = uploadBuffer(gl, null, buildLineVertices(coastlines), LINE_STRIDE);
    }

    if (scene.config.graticule.enabled && this.builtGraticuleStep !== scene.config.graticule.step) {
      this.builtGraticuleStep = scene.config.graticule.step;
      const paths = buildGraticule(LAYER_RADIUS.graticule, scene.config.graticule.step);
      this.graticuleBuffer = uploadBuffer(
        gl,
        this.graticuleBuffer,
        buildLineVertices(paths),
        LINE_STRIDE,
      );
    }
  }

  private syncRoutes(scene: Scene): void {
    if (
      this.builtRoutesRevision === scene.routesRevision &&
      this.builtStyleRevision === scene.styleRevision
    ) {
      return;
    }
    this.builtRoutesRevision = scene.routesRevision;

    const gl = this.gl;
    for (const batch of this.routeBatches) {
      gl.deleteBuffer(batch.buffer.buffer);
    }
    this.routeBatches = [];

    for (const prepared of scene.routes) {
      const data = buildLineVertices([prepared.positions]);
      const buffer = uploadBuffer(gl, null, data, LINE_STRIDE);
      if (!buffer) {
        continue;
      }
      const color = parseColor(prepared.route.color);
      this.routeBatches.push({
        buffer,
        rgb: [color[0], color[1], color[2]],
        alpha: color[3],
        opacity: prepared.route.opacity,
        fade: prepared.route.fade,
        fadeStart: prepared.route.fadeStart,
        width: prepared.route.width,
      });
    }
  }

  private syncPoints(scene: Scene): void {
    if (
      this.builtPointsRevision === scene.pointsRevision &&
      this.builtStyleRevision === scene.styleRevision
    ) {
      return;
    }
    this.builtPointsRevision = scene.pointsRevision;
    this.builtStyleRevision = scene.styleRevision;

    const corners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const data = new Float32Array(scene.points.length * corners.length * DOT_STRIDE);
    let offset = 0;

    for (const point of scene.points) {
      const position = lonLatToVec3(point.lon, point.lat, LAYER_RADIUS.point);
      const color = parseColor(point.color);
      const alpha = color[3] * point.opacity;
      // Milliseconds, matching `uTime` - the shader stays in the one unit throughout rather than
      // converting from the public, seconds-based `Fade` on every vertex of every frame.
      const fadeStart = point.fade && point.fadeStart !== undefined ? point.fadeStart : NO_FADE;
      const fadeIn = (point.fade?.in ?? 0) * 1000;
      const fadeStay = (point.fade?.stay ?? 0) * 1000;
      const fadeOut = (point.fade?.out ?? 0) * 1000;
      for (const corner of corners) {
        data[offset++] = position[0];
        data[offset++] = position[1];
        data[offset++] = position[2];
        data[offset++] = corner[0];
        data[offset++] = corner[1];
        data[offset++] = color[0];
        data[offset++] = color[1];
        data[offset++] = color[2];
        data[offset++] = alpha;
        data[offset++] = point.size;
        data[offset++] = fadeStart;
        data[offset++] = fadeIn;
        data[offset++] = fadeStay;
        data[offset++] = fadeOut;
      }
    }

    this.dotBuffer = uploadBuffer(this.gl, this.dotBuffer, data, DOT_STRIDE);
  }

  /**
   * Disable every vertex attribute array this renderer ever enables, so each frame starts from a
   * clean slate rather than carrying over whatever the previous one left bound.
   *
   * A vertex attribute array, once enabled, stays enabled regardless of whether the buffer backing
   * it still exists - that is global context state, not something scoped to one buffer. Deleting a
   * buffer - the point or route it belonged to having just been removed, say, leaving nothing left to
   * draw with that program this frame - does not disable the attributes that pointed at it. Left
   * enabled with nothing bound, they fail the *next* draw call that runs on this context with "no
   * buffer is bound to enabled attribute" - even one using a wholly different program, since
   * validation does not care which program is active, only that every currently-enabled slot has a
   * buffer behind it - silently drawing nothing. Run once before any drawing starts rather than
   * reactively wherever a draw gets skipped: a skip only protects whatever runs *after* it, and nothing
   * here draws in a fixed enough order to guarantee the one draw call that would otherwise inherit
   * stale state always comes after the skip that caused it, this frame or the next.
   */
  private resetAttributes(): void {
    this.surface.disableAttributes(['aPosition']);
    this.line.disableAttributes(['aStart', 'aEnd', 'aSideT']);
    this.dots.disableAttributes(['aCenter', 'aCorner', 'aColor', 'aSize', 'aFade']);
    this.atmosphere.disableAttributes(['aPosition']);
  }

  private drawSurface(
    buffer: VertexBuffer | null,
    color: string,
    eyeDirection: Vec3,
    shade: number,
  ): void {
    if (!buffer || !this.viewProjection || parseColor(color)[3] <= 0) {
      return;
    }
    const gl = this.gl;
    const rgba = parseColor(color);

    this.surface.use();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
    this.surface.bindAttribute('aPosition', 3, 3, 0);
    gl.uniformMatrix4fv(this.surface.uniform('uViewProjection'), false, this.viewProjection);
    gl.uniform4f(this.surface.uniform('uColor'), rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.uniform3f(
      this.surface.uniform('uEyeDirection'),
      eyeDirection[0],
      eyeDirection[1],
      eyeDirection[2],
    );
    gl.uniform1f(this.surface.uniform('uShade'), shade);
    gl.depthMask(true);
    gl.drawArrays(gl.TRIANGLES, 0, buffer.vertexCount);
  }

  private drawLines(
    buffer: VertexBuffer | null,
    color: string,
    width: number,
    halfViewport: [number, number],
    opacity: number,
  ): void {
    if (!buffer) {
      return;
    }
    const rgba = parseColor(color);
    // World geometry such as borders never has a `fade`, so the time passed alongside it is never
    // actually consulted - `fadeMultiplier` returns 1 unconditionally whenever `fade` is undefined.
    this.drawLineBatch(
      { buffer, rgb: [rgba[0], rgba[1], rgba[2]], alpha: rgba[3], opacity, width },
      halfViewport,
      0,
    );
  }

  private drawLineBatch(batch: RouteBatch, halfViewport: [number, number], time: number): void {
    const liveOpacity = batch.opacity * fadeMultiplier(batch.fade, batch.fadeStart, time);
    const alpha = batch.alpha * liveOpacity;
    if (!this.viewProjection || alpha <= 0) {
      return;
    }
    const gl = this.gl;
    this.line.use();
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer.buffer);
    this.line.bindAttribute('aStart', 3, LINE_STRIDE, 0);
    this.line.bindAttribute('aEnd', 3, LINE_STRIDE, 3);
    this.line.bindAttribute('aSideT', 2, LINE_STRIDE, 6);
    gl.uniformMatrix4fv(this.line.uniform('uViewProjection'), false, this.viewProjection);
    gl.uniform2f(this.line.uniform('uViewport'), halfViewport[0], halfViewport[1]);
    gl.uniform1f(this.line.uniform('uWidth'), batch.width * this.pixelRatio);
    gl.uniform4f(this.line.uniform('uColor'), batch.rgb[0], batch.rgb[1], batch.rgb[2], alpha);
    // Lines sit on the surface and would fight with it for depth, so they test but do not write.
    // Their quads are built in screen space, so their winding is arbitrary and culling must be off.
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, batch.buffer.vertexCount);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
  }

  private drawDots(halfViewport: [number, number], time: number, eye: Vec3): void {
    if (!this.dotBuffer || !this.viewProjection) {
      return;
    }
    const gl = this.gl;
    this.dots.use();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dotBuffer.buffer);
    this.dots.bindAttribute('aCenter', 3, DOT_STRIDE, 0);
    this.dots.bindAttribute('aCorner', 2, DOT_STRIDE, 3);
    this.dots.bindAttribute('aColor', 4, DOT_STRIDE, 5);
    this.dots.bindAttribute('aSize', 1, DOT_STRIDE, 9);
    this.dots.bindAttribute('aFade', 4, DOT_STRIDE, 10);
    gl.uniformMatrix4fv(this.dots.uniform('uViewProjection'), false, this.viewProjection);
    gl.uniform2f(this.dots.uniform('uViewport'), halfViewport[0], halfViewport[1]);
    gl.uniform1f(this.dots.uniform('uTime'), time);
    gl.uniform3f(this.dots.uniform('uEye'), eye[0], eye[1], eye[2]);
    gl.disable(gl.CULL_FACE);
    // The far side of the globe is hidden by the shader itself now (see shaders.ts), exactly rather
    // than by depth-testing a flat quad against the curved surface beneath it, which this dot being
    // a billboard - one constant depth across the whole quad - made unreliable off-centre. Nothing
    // else a dot is drawn against needs depth testing: land and water are the only other things drawn
    // this close to the surface, and depth testing against them was never for anything but this same
    // far-side case.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, this.dotBuffer.vertexCount);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  private drawAtmosphere(color: string, strength: number, eye: Vec3): void {
    if (!this.atmosphereBuffer || !this.viewProjection || strength <= 0) {
      return;
    }
    const gl = this.gl;
    const rgba = parseColor(color);

    this.atmosphere.use();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.atmosphereBuffer.buffer);
    this.atmosphere.bindAttribute('aPosition', 3, 3, 0);
    gl.uniformMatrix4fv(this.atmosphere.uniform('uViewProjection'), false, this.viewProjection);
    gl.uniform4f(this.atmosphere.uniform('uColor'), rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.uniform1f(this.atmosphere.uniform('uStrength'), strength);
    gl.uniform3f(this.atmosphere.uniform('uEye'), eye[0], eye[1], eye[2]);

    // Drawn from the inside with additive blending so it glows rather than tinting what is behind it.
    gl.cullFace(gl.FRONT);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, this.atmosphereBuffer.vertexCount);
    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.cullFace(gl.BACK);
  }
}
