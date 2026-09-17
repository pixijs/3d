import type { ColorSource, PointData, VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../../../core/shader/ShaderBit';
import type { PointData3D } from '../../../math/vector/PointData3D';
import type { PointData4D } from '../../../math/vector/PointData4D';

/**
 * A value for one attribute, shaped by its format: a number for a scalar,
 * `{x, y}` / `{x, y, z}` / `{x, y, z, w}` for vectors, and any `ColorSource`
 * for the built-in tint attribute
 * @category scene
 * @advanced
 */
export type ParticleAttributeValue = number | PointData | PointData3D | PointData4D | ColorSource;

/**
 * What a caller may pass for an attribute of a given format, read off the
 * format's own name: `float32x3` takes a `{ x, y, z }`, `float32` a number
 * @category scene
 * @advanced
 */
export type ParticleValueFor<F extends VertexFormat> = F extends `${string}x2`
  ? PointData
  : F extends `${string}x3`
    ? PointData3D
    : F extends `${string}x4`
      ? PointData4D
      : number;

/**
 * Folds a union into an intersection, so the attributes of every bit in a list
 * land on one object
 * @internal
 */
export type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (u: infer I) => void
  ? I
  : never;

/**
 * The values one bit's declared attributes accept, keyed by attribute name
 *
 * A bit declared with `satisfies ShaderBit` keeps its attribute names as
 * literal keys, so this is exact: unknown names and wrong shapes fail to
 * compile. A bit annotated `: ShaderBit` has lost them to an index signature,
 * so this degrades to accepting any name, and the runtime checks in
 * `ParticleContainer3D.setParticle` take over.
 * @internal
 */
export type BitValues<Bit> = Bit extends { attributes?: infer A }
  ? A extends Record<string, VertexFormat>
    ? string extends keyof A
      ? Record<string, ParticleAttributeValue>
      : { [K in keyof A]?: A[K] extends VertexFormat ? ParticleValueFor<A[K]> : never }
    : {}
  : {};

/**
 * The attributes every `ParticleContainer3D` carries, whatever bits it composes
 * @category scene
 * @advanced
 */
export interface ParticleBuiltInValues {
  /** The particle centre */
  aPosition?: PointData3D;
  /** `x` is the world-space diameter, `y` the rotation in radians */
  aParticleSizeRot?: PointData;
  /** The tint, any `ColorSource`; sRGB-decoded on the way in */
  aParticleColor?: ColorSource;
  /** The flipbook window `(u0, v0, uScale, vScale)`, flipbook systems only */
  aParticleUVFrame?: PointData4D;
}

/**
 * The values the attributes declared across the bits `B` accept, keyed by
 * attribute name; the part of {@link ParticleValues} that comes from the bits
 * rather than the container
 * @category scene
 * @advanced
 */
export type ParticleDeclaredValues<B extends readonly ShaderBit[]> = UnionToIntersection<BitValues<B[number]>>;

/**
 * Everything `ParticleContainer3D.setParticle` accepts on a container composed
 * from the bits `B`: the built-ins, plus whatever those bits declare, each
 * shaped by its format
 * @category scene
 * @advanced
 */
export type ParticleValues<B extends readonly ShaderBit[]> = ParticleBuiltInValues & ParticleDeclaredValues<B>;
