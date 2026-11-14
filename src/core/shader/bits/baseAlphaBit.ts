import type { ShaderBit } from '../ShaderBit';
import { baseColorTextureBit } from './baseColorTextureBit';

/**
 * Sets the fragment's `alpha` from the base colour: the alpha of the material's `baseColor` times
 * the alpha of its base colour texture
 *
 * Every engine material lists it, so each works out alpha the same way and its own colour bit
 * only sets `albedo`. List it ahead of the material's colour bit.
 * @category rendering
 * @advanced
 */
export const baseAlphaBit: ShaderBit = {
  name: 'baseAlpha',
  bindings: { material: { baseColor: 'vec4<f32>' } },
  requires: [baseColorTextureBit],
  gpu: { fragment: { material: 'alpha *= material.baseColor.a * baseTex.a;' } },
  gl: { fragment: { material: 'alpha *= material.baseColor.a * baseTex.a;' } },
};
