import type { ColorSource, PointData, VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../../../core/shader/ShaderBit';
import type { PointData3D } from '../../../math/vector/PointData3D';
import type { PointData4D } from '../../../math/vector/PointData4D';

/**
 * A value for one attribute, shaped by its format: a number for a scalar, `{ x, y }` to
 * `{ x, y, z, w }` for a vector, and any `ColorSource` for the built-in tint
 * @category scene
 * @advanced
 */
export type ParticleAttributeValue = number | PointData | PointData3D | PointData4D | ColorSource;

/**
 * The value an attribute of format `F` takes: `float32x3` takes `{ x, y, z }`, `float32` a number
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
 * The attributes every `ParticleContainer3D` carries, whatever bits it composes
 * @category scene
 * @advanced
 */
export interface ParticleBuiltInValues {
  /** The particle centre */
  aPosition?: PointData3D;
  /** `x` is the world-space diameter, `y` the rotation in radians */
  aParticleSizeRot?: PointData;
  /** The tint, any `ColorSource` in display (sRGB) space; its alpha, 1 when it has none, sets the opacity */
  aParticleColor?: ColorSource;
  /** The flipbook window `(u0, v0, uScale, vScale)`, flipbook systems only */
  aParticleUVFrame?: PointData4D;
}

/**
 * The part of {@link ParticleValues} that comes from the bits `B`: each attribute a bit declares,
 * shaped by its format
 * @category scene
 * @advanced
 */
export type ParticleDeclaredValues<B extends readonly ShaderBit[]> = (
  B[number] extends infer Bit
    ? Bit extends Partial<Record<'attributes', infer A>>
      ? (
          values: A extends Record<string, VertexFormat>
            ? string extends keyof A
              ? Record<string, ParticleAttributeValue>
              : { [K in keyof A]?: A[K] extends VertexFormat ? ParticleValueFor<A[K]> : never }
            : {},
        ) => void
      : (values: {}) => void
    : never
) extends (values: infer AllValues) => void
  ? AllValues
  : never;

/**
 * Everything `ParticleContainer3D.setParticle` accepts on a container composed from the bits `B`:
 * the built-ins, plus whatever those bits declare, each shaped by its format
 * @category scene
 * @advanced
 */
export type ParticleValues<B extends readonly ShaderBit[]> = ParticleBuiltInValues & ParticleDeclaredValues<B>;
