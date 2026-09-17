/**
 * Computes the Euclidean modulo `((n % m) + m) % m`, always returning a non-negative result
 * @see https://en.wikipedia.org/wiki/Modulo_operation
 * @param n - The dividend
 * @param m - The divisor
 * @returns The non-negative remainder of `n / m`
 * @category maths
 * @standard
 */
export function euclideanModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Returns a value that alternates between `0` and `length` as `x` increases
 * @see https://www.desmos.com/calculator/vcsjnyz7x4
 * @param x - The value to pingpong
 * @param length - The positive value the function will pingpong to
 * @returns The alternating value in `[0, length]`
 * @category maths
 * @standard
 */
export function pingpong(x: number, length = 1): number {
  return length - Math.abs(euclideanModulo(x, length * 2) - length);
}
