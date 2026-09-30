import type { DeepPartial } from '../types.ts';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge an override into a base, recursing into nested plain objects.
 *
 * Arrays and class instances are replaced wholesale rather than merged, which is what callers expect
 * when they pass something like a list of coordinates.
 */
export function deepMerge<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) {
    return base;
  }
  const result = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }
    const current = result[key];
    result[key] =
      isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return result as T;
}
