/**
 * Linearly interpolates between `x` and `y`
 * @see https://en.wikipedia.org/wiki/Linear_interpolation
 * @example
 * ```ts
 * sun.intensity = lerp(dayIntensity, nightIntensity, nightAmount);
 * ```
 * @param x - The start value, returned at `t = 0`
 * @param y - The end value, returned at `t = 1`
 * @param t - The interpolation factor; values outside `[0, 1]` extrapolate
 * @returns The interpolated value
 * @category maths
 * @standard
 */
export function lerp(x: number, y: number, t: number): number {
  return (1 - t) * x + t * y;
}

/**
 * Returns where `value` sits between `x` and `y`: 0 at `x`, 1 at `y`, the reverse of {@link lerp}
 * @example
 * ```ts
 * const throttle = inverseLerp(idleSpeed, topSpeed, car.speed);
 * ```
 * @param x - The start value
 * @param y - The end value
 * @param value - The value to locate; outside the range gives a result outside `[0, 1]`
 * @returns The interpolation factor, or 0 when `x` equals `y`
 * @category maths
 * @standard
 */
export function inverseLerp(x: number, y: number, value: number): number {
  if (x === y) return 0;

  return (value - x) / (y - x);
}

/**
 * Linearly maps `x` from the range `a1` to `a2` onto the range `b1` to `b2`, without clamping
 * @example
 * ```ts
 * engineSound.speed = mapLinear(car.speed, 0, topSpeed, 0.8, 1.6);
 * ```
 * @param x - The value to map
 * @param a1 - Start of the source range
 * @param a2 - End of the source range; must differ from `a1`
 * @param b1 - Start of the target range
 * @param b2 - End of the target range
 * @returns The mapped value
 * @category maths
 * @standard
 */
export function mapLinear(x: number, a1: number, a2: number, b1: number, b2: number): number {
  return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
}

/**
 * Moves `x` toward `y` by a share that depends on the time step, so the motion looks the same at
 * any frame rate
 * @see http://www.rorydriscoll.com/2016/03/07/frame-rate-independent-damping-using-lerp/
 * @example
 * ```ts
 * app.ticker.add((ticker) => {
 *   camera.x = damp(camera.x, player.x, 5, ticker.deltaMS / 1000);
 * });
 * ```
 * @param x - The current value
 * @param y - The target value
 * @param lambda - How fast `x` closes in on `y`; higher is snappier
 * @param dt - Delta time in seconds
 * @returns The damped value
 * @category maths
 * @standard
 */
export function damp(x: number, y: number, lambda: number, dt: number): number {
  return lerp(x, y, 1 - Math.exp(-lambda * dt));
}
