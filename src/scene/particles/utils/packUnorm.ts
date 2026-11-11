/**
 * A 0 to 1 value as a byte, clamped so an overshoot can't spill into the next channel of a packed word
 * @internal
 */
export function unorm8(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
}

/**
 * A 0 to 1 value as a clamped 16-bit integer
 * @internal
 */
export function unorm16(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 65535 : (v * 65535 + 0.5) | 0;
}
