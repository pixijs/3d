import type { ShaderBit } from '../ShaderBit';
import { uvTransformBit } from './uvTransformBit';

/**
 * Reads the material's base colour texture once, into the fragment local `baseTex`
 *
 * {@link baseAlphaBit} requires it, and each material's colour bit requires `baseAlphaBit`, so
 * a shader samples the texture once however many of them it lists. The sample is as uploaded,
 * premultiplied by its alpha, and is taken unconditionally: an unset slot holds `Texture.WHITE`,
 * which reads as `(1, 1, 1, 1)`.
 *
 * It samples at the mesh UVs as the material transforms them, so it requires
 * {@link uvTransformBit}.
 * @category rendering
 * @advanced
 */
export const baseColorTextureBit: ShaderBit = {
  name: 'baseColorTexture',
  textures: ['baseColor'],
  requires: [uvTransformBit],
  gpu: { fragment: { material: 'let baseTex = sampleBaseColor(input.vUV);' } },
  gl: { fragment: { material: 'vec4 baseTex = sampleBaseColor(vUV);' } },
};
