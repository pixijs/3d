/**
 * A per-particle starting value: a constant, or a `[min, max]` range each
 * particle draws from at spawn
 *
 * The two-number form is what gives a system its variety: a batch of smoke
 * puffs all exactly the same size reads as a machine, not as smoke.
 * @example
 * ```ts
 * new ParticleSystem3D({ life: 2, size: [0.3, 0.9] });
 * ```
 * @category extras:particles
 * @standard
 */
export type ParticleSpread = number | readonly [min: number, max: number];

/**
 * Writes a spread's `[min, max]` into `target` at `offset`
 *
 * Called when options are applied, never per spawn, so the hot path is one
 * multiply-add.
 * @param target - The spread table to write into
 * @param offset - Index of the pair's `min` slot; `max` goes in the next one
 * @param value - The spread as given in options, or `undefined` to use `fallback`
 * @param fallback - Constant written as both ends when `value` is `undefined`
 * @internal
 */
export function writeSpread(target: Float32Array, offset: number, value: ParticleSpread | undefined, fallback: number) {
  if (value === undefined) {
    target[offset] = fallback;
    target[offset + 1] = fallback;
  } else if (typeof value === 'number') {
    target[offset] = value;
    target[offset + 1] = value;
  } else {
    target[offset] = value[0];
    target[offset + 1] = value[1];
  }
}

/**
 * Draws one value from a spread previously written by `writeSpread`
 * @param spreads - The spread table `writeSpread` filled
 * @param offset - Index of the pair's `min` slot
 * @param rng - The system's random source
 * @returns A value in `[min, max]`, or `min` without a random draw when the two are equal.
 * @internal
 */
export function sampleSpread(spreads: Float32Array, offset: number, rng: () => number): number {
  const min = spreads[offset];
  const max = spreads[offset + 1];

  return min === max ? min : min + (max - min) * rng();
}
