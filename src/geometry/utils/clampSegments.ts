/** @internal */
export function clampSegments(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;

  return Math.max(min, Math.floor(value));
}
