/**
 * A 0..1 value as a clamped byte
 *
 * Clamped per channel so an overshoot can't spill into the neighbouring
 * channel of a packed word.
 * @param v - Value to pack, clamped to 0..1
 * @internal
 */
export function unorm8(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
}

/**
 * A 0..1 value as a clamped short
 * @param v - Value to pack, clamped to 0..1
 * @internal
 */
export function unorm16(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 65535 : (v * 65535 + 0.5) | 0;
}
