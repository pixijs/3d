import { WORDS_PER_TEXEL } from '../../buffers/dataTextureLayout';
import { MATERIAL_STRIDE_FLOATS } from '../../buffers/MaterialDataStoreBuffer';
import type { StructDefinition } from '../ShaderBit';
import { createStructLayout } from './structLayout';

/**
 * The scalar type a Material field is built from
 * @internal
 */
export type MaterialScalar = 'f32' | 'i32' | 'u32';

/**
 * Texels one material row occupies in the store's data texture
 * @internal
 */
export const MATERIAL_STRIDE_TEXELS = MATERIAL_STRIDE_FLOATS / WORDS_PER_TEXEL;

/**
 * The Material field types the accessors can read, mapped to the scalar type their bits are read
 * back as
 *
 * Every one fits a single texel, and `mergeMaterialStruct` refuses anything else. Integers are
 * scalars only, because the material data class writes vectors through its float view.
 * @internal
 */
export const MATERIAL_FIELD_SCALARS: Record<string, MaterialScalar | undefined> = {
  f32: 'f32',
  'vec2<f32>': 'f32',
  'vec3<f32>': 'f32',
  'vec4<f32>': 'f32',
  'mat2x2<f32>': 'f32',
  u32: 'u32',
  i32: 'i32',
};

/**
 * One Material field's place inside a texel
 * @internal
 */
export interface MaterialTexelField {
  name: string;
  /** WGSL field type */
  type: string;
  /** Scalar type; a texel holds exact `u32` bits, and every other scalar is those bits reinterpreted */
  scalar: MaterialScalar;
  /** Picks the field out of its texel: `''` for a whole texel, otherwise `.x`, `.zw`, `.xyz` and so on */
  swizzle: string;
}

/**
 * Lays the packed Material struct over the texels of its store row
 *
 * The GLSL and WGSL accessor generators share it, so both read the same texels for the same
 * fields. It expects the output of `mergeMaterialStruct`, which admits only
 * `MATERIAL_FIELD_SCALARS` types, packs them so no field straddles a texel, and refuses a struct
 * past the store stride.
 * @param fields - The packed Material struct, in emission order.
 * @returns Fields grouped by texel index, in ascending texel order.
 * @internal
 */
export function layoutMaterialTexels(fields: StructDefinition): Map<number, MaterialTexelField[]> {
  const layout = createStructLayout(fields);
  const texels = new Map<number, MaterialTexelField[]>();

  for (const elem of layout.elements) {
    const wordOffset = elem.offset / 4;
    const texelIndex = Math.floor(wordOffset / WORDS_PER_TEXEL);
    const componentStart = wordOffset % WORDS_PER_TEXEL;
    const swizzle =
      elem.components === WORDS_PER_TEXEL ? '' : `.${'xyzw'.slice(componentStart, componentStart + elem.components)}`;
    const scalar = MATERIAL_FIELD_SCALARS[elem.type]!;

    let entries = texels.get(texelIndex);
    if (!entries) texels.set(texelIndex, (entries = []));

    entries.push({ name: elem.name, type: elem.type, scalar, swizzle });
  }

  return texels;
}
