/**
 * A per-particle starting value: a constant, or a `[min, max]` range each particle draws from at
 * spawn
 * @example
 * ```ts
 * new ParticleSystem3D({ life: 2, size: [0.3, 0.9] });
 * ```
 * @category extras:particles
 * @standard
 */
export type ParticleSpread = number | readonly [min: number, max: number];

/** @internal */
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
 * Skips the random draw when min equals max, as the copy `generateSpawn` inlines must too
 * @internal
 */
export function sampleSpread(spreads: Float32Array, offset: number, rng: () => number): number {
  const min = spreads[offset];
  const max = spreads[offset + 1];

  return min === max ? min : min + (max - min) * rng();
}
