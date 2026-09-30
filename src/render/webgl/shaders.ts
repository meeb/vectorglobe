/**
 * GLSL sources.
 *
 * Written against GLSL ES 1.00 so the same shaders run on a WebGL 1 context as well as a WebGL 2 one,
 * which is what lets the renderer work without instancing or any extension.
 */

/** Sphere and land share a program: both are solid shapes shaded by how much they face the viewer. */
export const SURFACE_VERTEX = `
attribute vec3 aPosition;
uniform mat4 uViewProjection;
varying vec3 vNormal;

void main() {
  vNormal = normalize(aPosition);
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

export const SURFACE_FRAGMENT = `
precision mediump float;
uniform vec4 uColor;
uniform vec3 uEyeDirection;
uniform float uShade;
varying vec3 vNormal;

void main() {
  // Gently darken towards the limb so the globe reads as a sphere rather than a flat disc.
  float facing = max(dot(normalize(vNormal), uEyeDirection), 0.0);
  float shade = mix(1.0 - uShade, 1.0, pow(facing, 0.55));
  gl_FragColor = vec4(uColor.rgb * shade, uColor.a);
}
`;

/**
 * Lines are expanded into quads here rather than on the CPU.
 *
 * Both endpoints of the segment are supplied with every vertex, so the shader can measure the
 * segment's direction on screen and push the vertex sideways by a constant number of pixels. That is
 * what gives borders and routes a consistent width at any zoom, which plain GL lines cannot do.
 */
export const LINE_VERTEX = `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aSideT;

uniform mat4 uViewProjection;
uniform vec2 uViewport;
uniform float uWidth;

void main() {
  vec4 clipStart = uViewProjection * vec4(aStart, 1.0);
  vec4 clipEnd = uViewProjection * vec4(aEnd, 1.0);

  // Guard against a zero or negative w, which happens for points at or behind the eye.
  float wStart = max(abs(clipStart.w), 0.0001);
  float wEnd = max(abs(clipEnd.w), 0.0001);
  vec2 screenStart = (clipStart.xy / wStart) * uViewport;
  vec2 screenEnd = (clipEnd.xy / wEnd) * uViewport;

  vec2 delta = screenEnd - screenStart;
  float len = length(delta);
  vec2 direction = len > 0.0001 ? delta / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-direction.y, direction.x);

  vec4 clip = mix(clipStart, clipEnd, aSideT.y);
  clip.xy += (normal * aSideT.x * uWidth * 0.5 / uViewport) * clip.w;
  gl_Position = clip;
}
`;

export const LINE_FRAGMENT = `
precision mediump float;
uniform vec4 uColor;

void main() {
  gl_FragColor = uColor;
}
`;

/** Dots are camera facing quads carrying their own colour and size. */
export const DOT_VERTEX = `
attribute vec3 aCenter;
attribute vec2 aCorner;
attribute vec4 aColor;
attribute float aSize;

uniform mat4 uViewProjection;
uniform vec2 uViewport;

varying vec2 vCorner;
varying vec4 vColor;

void main() {
  vec4 clip = uViewProjection * vec4(aCenter, 1.0);
  clip.xy += (aCorner * aSize / uViewport) * clip.w;
  vCorner = aCorner;
  vColor = aColor;
  gl_Position = clip;
}
`;

export const DOT_FRAGMENT = `
precision mediump float;
varying vec2 vCorner;
varying vec4 vColor;

void main() {
  // A signed distance circle, antialiased against the quad it is drawn in.
  float distance = length(vCorner);
  float alpha = 1.0 - smoothstep(0.82, 1.0, distance);
  if (alpha <= 0.0) {
    discard;
  }
  gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
}
`;

/**
 * The atmosphere is a slightly larger sphere drawn from the inside.
 *
 * Only the part near the limb lights up, which reads as air catching the light around the edge of
 * the globe without covering anything drawn on the surface.
 */
export const ATMOSPHERE_VERTEX = `
attribute vec3 aPosition;
uniform mat4 uViewProjection;
uniform vec3 uEye;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  vNormal = normalize(aPosition);
  vView = normalize(uEye - aPosition);
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}
`;

export const ATMOSPHERE_FRAGMENT = `
precision mediump float;
uniform vec4 uColor;
uniform float uStrength;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
  float intensity = pow(clamp(rim, 0.0, 1.0), 3.0) * uStrength;
  gl_FragColor = vec4(uColor.rgb * intensity, uColor.a * intensity);
}
`;
