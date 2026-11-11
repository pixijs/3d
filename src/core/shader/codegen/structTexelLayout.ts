import { WORDS_PER_TEXEL } from '../../buffers/dataTextureLayout';
import type { StructDefinition } from '../ShaderBit';
import { createStructLayout } from './structLayout';

type TexelScalar = 'f32' | 'i32' | 'u32';

function texelScalar(type: string): TexelScalar {
  if (type.includes('u32')) return 'u32';
  if (type.includes('i32')) return 'i32';

  return 'f32';
}

/** @internal */
export interface TexelField {
  name: string;
  type: string;
  /** A texel holds exact `u32` bits; any other scalar is those bits reinterpreted */
  scalar: TexelScalar;
  /** `''` for a whole texel, otherwise a swizzle such as `.zw` */
  swizzle: string;
}

/**
 * No field may straddle a texel; `mergeMaterialStruct`'s types and instance data's `vec4`s never do
 * @param fields - The struct, in declaration order
 * @param read - The fields to keep; the rest still take their place. Defaults to every field.
 * @internal
 */
export function layoutStructTexels(fields: StructDefinition, read?: ReadonlySet<string>): Map<number, TexelField[]> {
  const layout = createStructLayout(fields);
  const texels = new Map<number, TexelField[]>();

  for (const elem of layout.elements) {
    if (read && !read.has(elem.name)) continue;

    const wordOffset = elem.offset / 4;
    const texelIndex = Math.floor(wordOffset / WORDS_PER_TEXEL);
    const componentStart = wordOffset % WORDS_PER_TEXEL;
    const swizzle =
      elem.components === WORDS_PER_TEXEL ? '' : `.${'xyzw'.slice(componentStart, componentStart + elem.components)}`;

    let entries = texels.get(texelIndex);
    if (!entries) texels.set(texelIndex, (entries = []));

    entries.push({ name: elem.name, type: elem.type, scalar: texelScalar(elem.type), swizzle });
  }

  return texels;
}
