import type { ColorSource } from 'pixi.js';

import type { ShaderBit } from '../../../core/shader/ShaderBit';
import type { PointData3D } from '../../../math/vector/PointData3D';
import type { PointData4D } from '../../../math/vector/PointData4D';
import type { ParticleDeclaredValues } from '../../../scene/particles/utils/particleValues';

/**
 * A value handed to `spawn()` for a whole batch
 *
 * One value every particle gets, a pair each particle draws between, or a
 * function called per particle with the system's random source and the slot
 * index. Pairs of points draw per component, so two corners make a box.
 * @example
 * ```ts
 * sparks.spawn(10, {
 *   life: 2,
 *   size: [0.1, 0.4],
 *   startRotation: (rng: () => number) => rng() * Math.PI * 2,
 * });
 * ```
 * @category extras:particles
 * @standard
 */
export type ParticleSpawnValue<V> = V | readonly [V, V] | ((rng: () => number, index: number) => V);

/**
 * The overrides every system accepts, whatever bits it composes
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
   * Where to put this spawn
   *
   * The point stands in for the emitter's transform: the shape adds its own
   * offset around it, unrotated and unscaled. The direction still follows the
   * emitter's rotation.
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
   * Starting spin angle about the view axis, in radians
   * @example
   * ```ts
   * leaves.spawn(6, { startRotation: (rng: () => number) => rng() * Math.PI });
   * ```
   */
  startRotation?: ParticleSpawnValue<number>;
  /**
   * Starting tint. One per batch: a `ColorSource` can itself be an array, so a pair would be ambiguous
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
}

/**
 * Per-spawn overrides for {@link ParticleSystem3D.spawn}
 *
 * Anything omitted comes from the system's options as usual. `position` and
 * `velocity` are in the system's own space: world-space unless the system was
 * built with `space: 'local'`. Any attribute the system's
 * `extraBits` declare is accepted under its own name, shaped by its format, and
 * typed exactly when the bit was declared with `satisfies ShaderBit`.
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
 * The attributes the system's own behaviour bits declare, on top of the
 * container's built-ins
 *
 * `aVel`, `aBirth` and `aLife` are always there. The rest exist only when the
 * option that composes their bit was given, so writing one the system did not
 * compose throws at runtime.
 * @category extras:particles
 * @advanced
 */
export interface ParticleSystemValues {
  /** Launch velocity */
  aVel?: PointData3D;
  /** Birth time on the system clock */
  aBirth?: number;
  /** Lifetime in seconds */
  aLife?: number;
  /** End-of-life size, with `sizeEnd` */
  aSizeEnd?: number;
  /** End-of-life opacity, with `alphaEnd` */
  aAlphaEnd?: number;
  /** End-of-life tint as linear `{ x, y, z, w }`, with `colorEnd` */
  aColorEnd?: PointData4D;
  /** Rotation rate in radians per second, with `spin` */
  aSpin?: number;
}
