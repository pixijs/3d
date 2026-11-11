import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Each binding needs an entry in `getGlobalGlData`'s bind group, which the shadow pass draws from
 * @internal
 */
export const shadowGlobalBitGl: ShaderBit = {
  name: 'shadowGlobalGl',
  bindings: {
    global: {
      uBonePitTexture: 'texture_2d<f32>',
      uMorphTexture: 'texture_2d<f32>',
      uGeometryTexture: 'texture_2d<u32>',
    },
  },
};
