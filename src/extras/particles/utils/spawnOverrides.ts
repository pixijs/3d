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
 * @category extras:particles
 * @standard
 */
export type ParticleSpawnValue<V> = V | readonly [V, V] | ((rng: () => number, index: number) => V);

/**
 * The overrides every system accepts, whatever bits it composes
 * @category extras:particles
 * @standard
 */
export interface ParticleSpawnBuiltInOverrides {
  /**
   * Where to put this spawn
   *
   * You're placing it yourself, so the emitter's own position is left out and
   * the shape contributes only its scatter around this point:
   * `spawn(3, { position: wheel })` with a `ConeShape` still gives you three
   * jittered particles at the wheel. The cone still points the way the emitter
   * is rotated.
   */
  position?: ParticleSpawnValue<PointData3D>;
  /** Initial velocity, replacing `speed` along the shape's direction */
  velocity?: ParticleSpawnValue<PointData3D>;
  /** Lifetime in seconds */
  life?: ParticleSpawnValue<number>;
  /** Starting world-space diameter */
  size?: ParticleSpawnValue<number>;
  /** Starting spin angle about the view axis, in radians */
  startRotation?: ParticleSpawnValue<number>;
  /** Starting tint. One per batch: a `ColorSource` can itself be an array, so a pair would be ambiguous */
  color?: ColorSource;
  /** Starting opacity */
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
  /** Rotation rate, with `spin` */
  aSpin?: number;
}
