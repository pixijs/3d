import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Must follow `phongMaterialBit`, which declares the `specularStrength` it scales
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
