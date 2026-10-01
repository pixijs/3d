/**
 * Remainder of `n / m` that takes the sign of `m`, so unlike `%` it never goes negative for a
 * positive `m`
 * @see https://en.wikipedia.org/wiki/Modulo_operation
 * @example
 * ```ts
 * const previous = items[euclideanModulo(index - 1, items.length)];
 * ```
 * @param n - The dividend
 * @param m - The divisor
 * @returns The remainder, in `[0, m)` for a positive `m`
 * @category maths
 * @standard
 */
export function euclideanModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Bounces between 0 and `length` as `x` grows: up from 0 to `length`, then back down to 0
 * @see https://www.desmos.com/calculator/vcsjnyz7x4
 * @example
 * ```ts
 * platform.y = pingpong(elapsed, 3);
 * ```
 * @param x - The value to bounce, such as elapsed time
 * @param length - The highest value returned, reached at odd multiples of `length`
 * @returns The value in `[0, length]`
 * @category maths
 * @standard
 */
export function pingpong(x: number, length = 1): number {
  return length - Math.abs(euclideanModulo(x, length * 2) - length);
}
