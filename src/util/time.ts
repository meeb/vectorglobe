/** Monotonic clock in milliseconds, falling back for environments without `performance`. */
export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
