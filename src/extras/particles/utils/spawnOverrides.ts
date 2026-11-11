import type { ColorSource } from 'pixi.js';

import type { ShaderBit } from '../../../core/shader/ShaderBit';
import type { PointData3D } from '../../../math/vector/PointData3D';
import type { PointData4D } from '../../../math/vector/PointData4D';
import type { ParticleDeclaredValues } from '../../../scene/particles/utils/particleValues';

/**
 * A `spawn()` override: one value for the whole batch, a pair each particle draws between, or a
 * function called per particle
 *
 * The function gets the system's random source and the particle's place in the batch, 0 to
 * `count - 1`. A pair of points draws each component on its own, so two corners make a box.
 * @example
 * ```ts
 * sparks.spawn(10, {
 *   life: 2,
 *   size: [0.1, 0.4],
 *   startRotation: (rng: () => number) => rng() * Math.PI * 2,
 * });
 * sparks.spawn(8, { position: (_rng: () => number, i: number) => ringPoints[i] });
 * ```
 * @category extras:particles
 * @standard
 */
export type ParticleSpawnValue<V> = V | readonly [V, V] | ((rng: () => number, index: number) => V);

/**
 * The overrides `spawn()` takes for the system's own behaviour
 *
 * `spawn()` throws on an override the system wasn't built to take.
 * @example
 * ```ts
 * const impact: ParticleSpawnBuiltInOverrides = { position: hit.point, life: [0.2, 0.5], color: 'white' };
 *
 * sparks.spawn(12, impact);
 * ```
 * @category extras:particles
 * @standard
 */
export interface ParticleSpawnBuiltInOverrides {
  /**
   * Where this batch spawns, in place of the emitter's position
   *
   * In a world-space system, the shape's offsets are added unrotated and unscaled, while directions
   * still follow the emitter's rotation.
   * @example
   * ```ts
   * dust.spawn(3, { position: { x: wheel.x, y: 0, z: wheel.z } });
   * ```
   */
  position?: ParticleSpawnValue<PointData3D>;
  /**
   * Initial velocity, replacing `speed` along the shape's direction
   * @example
   * ```ts
   * sparks.spawn(1, { velocity: { x: 0, y: 6, z: 0 } });
   * ```
   */
  velocity?: ParticleSpawnValue<PointData3D>;
  /**
   * Lifetime in seconds
   * @example
   * ```ts
   * sparks.spawn(4, { life: [0.5, 1] });
   * ```
   */
  life?: ParticleSpawnValue<number>;
  /**
   * Starting world-space diameter
   * @example
   * ```ts
   * sparks.spawn(4, { size: 0.5 });
   * ```
   */
  size?: ParticleSpawnValue<number>;
  /**
   * Starting spin angle in radians, turning the quad in its own plane
   * @example
   * ```ts
   * leaves.spawn(6, { startRotation: (rng: () => number) => rng() * Math.PI });
   * ```
   */
  startRotation?: ParticleSpawnValue<number>;
  /**
   * Starting tint, one for the whole batch: it takes no pair or function
   * @example
   * ```ts
   * sparks.spawn(8, { color: 'red' });
   * ```
   */
  color?: ColorSource;
  /**
   * Starting opacity
   * @example
   * ```ts
   * smoke.spawn(8, { alpha: [0.3, 0.6] });
   * ```
   */
  alpha?: ParticleSpawnValue<number>;
  /**
   * End-of-life size; only on a system built with `sizeEnd`
   * @example
   * ```ts
   * puffs.spawn(4, { sizeEnd: [2, 3] });
   * ```
   */
  sizeEnd?: ParticleSpawnValue<number>;
  /**
   * End-of-life opacity; only on a system built with `alphaEnd`
   * @example
   * ```ts
   * smoke.spawn(4, { alphaEnd: 0.2 });
   * ```
   */
  alphaEnd?: ParticleSpawnValue<number>;
  /**
   * Rotation rate in radians per second; only on a system built with `spin`
   * @example
   * ```ts
   * debris.spawn(6, { spin: [-6, 6] });
   * ```
   */
  spin?: ParticleSpawnValue<number>;
  /**
   * End-of-life tint, one for the whole batch; only on a system built with `colorEnd`
   * @example
   * ```ts
   * embers.spawn(8, { colorEnd: 0x330000 });
   * ```
   */
  colorEnd?: ColorSource;
}

/**
 * Per-spawn overrides for {@link ParticleSystem3D.spawn}
 *
 * Anything omitted comes from the system's options, or is zero for an attribute from `extraBits`.
 * `position` and `velocity` are in world space unless the system was built with `space: 'local'`.
 * An attribute the system's `extraBits` declare is accepted under its own name, shaped by its
 * format, and type-checked when the bit was declared with `satisfies ShaderBit`.
 * @example
 * ```ts
 * const windBit = { name: 'wind', attributes: { aWind: 'float32x3' } } satisfies ShaderBit;
 * const leaves = new ParticleSystem3D({ extraBits: [windBit] });
 *
 * leaves.spawn(10, { aWind: { x: 1, y: 0, z: 0 }, life: 4 });
 * ```
 * @category extras:particles
 * @standard
 */
export type ParticleSpawnOverrides<B extends readonly ShaderBit[] = readonly ShaderBit[]> =
  ParticleSpawnBuiltInOverrides & {
    [K in keyof ParticleDeclaredValues<B>]?: ParticleSpawnValue<NonNullable<ParticleDeclaredValues<B>[K]>>;
  };

/**
 * The system's own attributes, which {@link ParticleSystem3D.setParticle | setParticle} takes on top
 * of the container's
 *
 * `aVel`, `aBirth` and `aLife` are always there. The rest exist only on a system built with their
 * option; on any other, `setParticle` throws on them. {@link ParticleSystem3D.spawn | spawn} takes
 * most of them under their option names instead, such as `sizeEnd` for `aSizeEnd`.
 * @category extras:particles
 * @advanced
 */
export interface ParticleSystemValues {
  /** Launch velocity, in units per second */
  aVel?: PointData3D;
  /** Birth time on the system clock */
  aBirth?: number;
  /** Lifetime in seconds */
  aLife?: number;
  /** End-of-life size, with `sizeEnd` */
  aSizeEnd?: number;
  /** End-of-life opacity, with `alphaEnd` */
  aAlphaEnd?: number;
  /** End-of-life tint in display (sRGB) space, each component 0 to 1, with `colorEnd` */
  aColorEnd?: PointData4D;
  /** Rotation rate in radians per second, with `spin` */
  aSpin?: number;
}
