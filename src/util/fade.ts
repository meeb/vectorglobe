import type { ResolvedFade } from '../types.ts';

/**
 * How much of a point or route's own opacity should show right now, as a 0 to 1 multiplier - 1 when
 * there is no fade (or none has started yet), ramping up, holding, then ramping back down to 0 across
 * the three phases of {@link ResolvedFade} once one has.
 *
 * Shared by every renderer that computes opacity on the CPU (the 2D canvas, and labels, both of which
 * already redraw from scratch every frame); the WebGL renderer instead uploads `fade` and `fadeStart`
 * once as vertex data and does this same calculation in the shader every frame from a single `uTime`
 * uniform, so a fade animates without the per-frame buffer rebuild this function would otherwise cost
 * at scale. Keep the two in step if this changes - see `fadeMultiplier` in `shaders.ts`.
 */
export function fadeMultiplier(
  fade: ResolvedFade | undefined,
  fadeStart: number | undefined,
  nowMs: number,
): number {
  if (!fade || fadeStart === undefined) {
    return 1;
  }
  const elapsed = (nowMs - fadeStart) / 1000;
  if (elapsed < 0) {
    return 0;
  }
  if (elapsed < fade.in) {
    return fade.in > 0 ? elapsed / fade.in : 1;
  }
  const stayEnd = fade.in + fade.stay;
  if (elapsed < stayEnd) {
    return 1;
  }
  const outElapsed = elapsed - stayEnd;
  if (outElapsed < fade.out) {
    return fade.out > 0 ? 1 - outElapsed / fade.out : 0;
  }
  return 0;
}
