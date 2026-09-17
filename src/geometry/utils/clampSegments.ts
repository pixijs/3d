/**
 * Floors `value` to an integer and clamps it to at least `min`
 *
 * Returns `min` for non-finite inputs (NaN, Infinity).
 * @param value - The requested segment count.
 * @param min - The lower bound applied after flooring.
 * @returns The floored, clamped segment count.
 * @internal
 */
export function clampSegments(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;

  return Math.max(min, Math.floor(value));
}
