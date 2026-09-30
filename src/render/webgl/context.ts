/**
 * WebGL context creation and buffer plumbing.
 */

export interface ContextResult {
  gl: WebGLRenderingContext;
  /** True when the context is a WebGL 2 one. The renderer works either way. */
  version2: boolean;
}

/** Create a rendering context, preferring WebGL 2 but accepting WebGL 1. */
export function createContext(canvas: HTMLCanvasElement, antialias: boolean): ContextResult | null {
  const attributes: WebGLContextAttributes = {
    alpha: true,
    antialias,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'default',
  };

  const gl2 = canvas.getContext('webgl2', attributes) as WebGLRenderingContext | null;
  if (gl2) {
    return { gl: gl2, version2: true };
  }
  const gl1 = (canvas.getContext('webgl', attributes) ??
    canvas.getContext('experimental-webgl', attributes)) as WebGLRenderingContext | null;
  return gl1 ? { gl: gl1, version2: false } : null;
}

/** A vertex buffer together with how many vertices it holds. */
export interface VertexBuffer {
  buffer: WebGLBuffer;
  vertexCount: number;
}

/** Upload float data, reusing the existing buffer object when there is one. */
export function uploadBuffer(
  gl: WebGLRenderingContext,
  existing: VertexBuffer | null,
  data: Float32Array,
  stride: number,
): VertexBuffer | null {
  if (data.length === 0) {
    if (existing) {
      gl.deleteBuffer(existing.buffer);
    }
    return null;
  }

  const buffer = existing?.buffer ?? gl.createBuffer();
  if (!buffer) {
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { buffer, vertexCount: data.length / stride };
}

/** Release a buffer if it exists. */
export function deleteBuffer(gl: WebGLRenderingContext, buffer: VertexBuffer | null): void {
  if (buffer) {
    gl.deleteBuffer(buffer.buffer);
  }
}
