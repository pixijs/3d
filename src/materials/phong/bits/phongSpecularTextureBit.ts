import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Modulates the Blinn-Phong specular strength by a grayscale texture
 *
 * Read from the red channel (the de-facto convention for standalone specular
 * maps). Added only when a specular texture is supplied — it overwrites the
 * `specularStrength` default (1.0) that `phongMaterialBit` declares, so
 * it must sit after that bit in the descriptor.
 * @internal
 */
export const phongSpecularTextureBit: ShaderBit = {
  name: 'phongSpecularTexture',

  textures: ['specular'],

  gpu: {
    fragment: {
      material: /*wgsl*/ `
  specularStrength *= sampleSpecular(input.vUV).r;
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  specularStrength *= sampleSpecular(vUV).r;
`,
    },
  },
};
