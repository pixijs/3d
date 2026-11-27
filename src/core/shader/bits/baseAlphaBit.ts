import type { ShaderBit } from '../ShaderBit';
import { baseColorTextureBit } from './baseColorTextureBit';

/**
 * Sets the fragment's `alpha` from the base colour: the alpha of the material's `baseColor` times
 * the alpha of its base colour texture
 *
 * Each engine material's colour bit requires it, so every material works out alpha the same way
 * and its colour bit only sets `albedo`.
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
