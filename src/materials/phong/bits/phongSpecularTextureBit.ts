import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Scales `specularStrength` by the red channel of the material's specular map
 *
 * Red is the usual channel for a standalone specular map. Present only on a material built with
 * `specularTexture`. It multiplies the value `phongMaterialBit` declares, so it must come after
 * that bit.
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
