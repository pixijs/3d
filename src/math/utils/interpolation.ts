/**
 * Linearly interpolates between `x` and `y`
 * @see https://en.wikipedia.org/wiki/Linear_interpolation
 * @param x - The start value
 * @param y - The end value
 * @param t - The interpolation factor in `[0, 1]`
 * @returns The interpolated value
 * @category maths
 * @standard
 */
export function lerp(x: number, y: number, t: number): number {
  return (1 - t) * x + t * y;
}

/**
 * Returns the percentage in `[0, 1]` of `value` between `x` and `y`
 * @param x - The start value
 * @param y - The end value
 * @param value - A value between start and end
 * @returns The interpolation factor, or 0 when `x` equals `y`
 * @category maths
 * @standard
 */
export function inverseLerp(x: number, y: number, value: number): number {
  if (x === y) return 0;

  return (value - x) / (y - x);
}

/**
 * Linearly maps `x` from range `<a1, a2>` to range `<b1, b2>`
 * @param x - The value to be mapped
 * @param a1 - Minimum value of the source range
 * @param a2 - Maximum value of the source range
 * @param b1 - Minimum value of the target range
 * @param b2 - Maximum value of the target range
 * @returns The mapped value
 * @category maths
 * @standard
 */
export function mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number {
  return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
}

/**
 * Frame-rate independent damping using lerp
 * @see http://www.rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/
 * @param x - The current value
 * @param y - The target value
 * @param lambda - Higher values make the movement more sudden, lower values more gradual
 * @param dt - Delta time in seconds
 * @returns The damped value
 * @category maths
 * @standard
 */
export function damp(x: number, y: number, lambda: number, dt: number): number {
  return lerp(x, y, 1 - Math.exp(-lambda * dt));
}
