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

/**
 * Dots are camera facing quads carrying their own colour and size.
 *
 * A dot does not depth test against the globe the way everything else does (see the file header).
 * It is a flat, camera-facing quad at one constant depth - its centre's - while the sphere beneath it
 * curves away on every side, so the two depths only actually agree right at the quad's own centre.
 * Off-centre, the true surface is further away than the flat quad guesses it to be, by more the
 * further the dot sits from the middle of the view - harmless most of the time since the quad is
 * still nearer than that guess, but not always: near the horizon the gap closes and part of the quad
 * can end up testing as behind ground that, in reality, it clears. No fixed amount of padding above
 * the surface fixes this in general - it would need to grow with distance from the view's centre to
 * cover every angle, and a fixed choice is either wasteful face-on or still wrong near the limb.
 *
 * Hiding the far side of the globe is the only reason a dot was depth tested against it at all, so
 * this instead asks the exact question that was standing in for - `project()` below uses the same
 * one on the CPU for labels and hit-testing: a point at or above the surface is on the visible side
 * exactly when `dot(position, eye) >= 1`. Below that, the whole dot - not just part of its quad - is
 * pushed to a degenerate, off-screen position, which is cheap (once per vertex, no texture or buffer
 * reads) and exact at every angle, not just within whatever margin a fixed radius happened to cover.
 *
 * `aFade` is (start, in, stay, out), all in the same milliseconds as `uTime`; `aFade.x < 0.0` means
 * no fade at all. This mirrors `fadeMultiplier` in `util/fade.ts` exactly - keep the two in step.
 * Computing it here, once per vertex from one shared `uTime` uniform, is what lets a fade animate
 * every frame without the dot buffer - shared by every point on the map - needing to be rebuilt to
 * update it, the way any actual change to a point's data otherwise would.
 */
export const DOT_VERTEX = `
attribute vec3 aCenter;
attribute vec2 aCorner;
attribute vec4 aColor;
attribute float aSize;
attribute vec4 aFade;

uniform mat4 uViewProjection;
uniform vec2 uViewport;
uniform float uTime;
uniform vec3 uEye;

varying vec2 vCorner;
varying vec4 vColor;

float fadeMultiplier(vec4 fade, float time) {
  if (fade.x < 0.0) {
    return 1.0;
  }
  float elapsed = time - fade.x;
  if (elapsed < 0.0) {
    return 0.0;
  }
  if (elapsed < fade.y) {
    return fade.y > 0.0 ? elapsed / fade.y : 1.0;
  }
  float stayEnd = fade.y + fade.z;
  if (elapsed < stayEnd) {
    return 1.0;
  }
  float outElapsed = elapsed - stayEnd;
  if (outElapsed < fade.w) {
    return fade.w > 0.0 ? 1.0 - outElapsed / fade.w : 0.0;
  }
  return 0.0;
}

void main() {
  if (dot(aCenter, uEye) < 1.0) {
    // Degenerate: a zero clip-space position is discarded by the rasteriser rather than drawn.
    gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  vec4 clip = uViewProjection * vec4(aCenter, 1.0);
  clip.xy += (aCorner * aSize / uViewport) * clip.w;
  vCorner = aCorner;
  vColor = vec4(aColor.rgb, aColor.a * fadeMultiplier(aFade, uTime));
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
