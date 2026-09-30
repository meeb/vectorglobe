/**
 * Shader program helpers.
 *
 * Locations are looked up once at link time and cached, so the draw path never calls into the slow
 * introspection entry points.
 */

export class Program {
  readonly program: WebGLProgram;
  private gl: WebGLRenderingContext;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private attributes = new Map<string, number>();

  constructor(
    gl: WebGLRenderingContext,
    vertexSource: string,
    fragmentSource: string,
    name: string,
  ) {
    this.gl = gl;
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource, `${name} vertex`);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, `${name} fragment`);

    const program = gl.createProgram();
    if (!program) {
      throw new Error('vectorglobe: could not create a shader program');
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`vectorglobe: could not link the ${name} program: ${log}`);
    }

    // The shaders are owned by the linked program from here on.
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    this.program = program;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  uniform(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name) ?? null;
  }

  attribute(name: string): number {
    let location = this.attributes.get(name);
    if (location === undefined) {
      location = this.gl.getAttribLocation(this.program, name);
      this.attributes.set(name, location);
    }
    return location;
  }

  /** Bind an interleaved float attribute. Stride and offset are counted in floats, not bytes. */
  bindAttribute(name: string, size: number, stride: number, offset: number): void {
    const location = this.attribute(name);
    if (location < 0) {
      return;
    }
    this.gl.enableVertexAttribArray(location);
    this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, stride * 4, offset * 4);
  }

  disableAttributes(names: string[]): void {
    for (const name of names) {
      const location = this.attribute(name);
      if (location >= 0) {
        this.gl.disableVertexAttribArray(location);
      }
    }
  }

  destroy(): void {
    this.gl.deleteProgram(this.program);
    this.uniforms.clear();
    this.attributes.clear();
  }
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error(`vectorglobe: could not create the ${label} shader`);
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`vectorglobe: could not compile the ${label} shader: ${log}`);
  }
  return shader;
}
