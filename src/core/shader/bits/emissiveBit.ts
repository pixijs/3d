import type { ShaderBit } from '../ShaderBit';

/**
 * Field and texture names must match `EmissivePropsClass` in `materials/utils/emissiveProps.ts`
 * @internal
 */
export const emissiveBit: ShaderBit = {
  name: 'emissive',
  textures: ['emissive'],
  bindings: {
    material: {
      emissive: 'vec3<f32>',
      emissiveStrength: 'f32',
    },
  },
  gpu: {
    fragment: {
      material: /*wgsl*/ `
  emissive = material.emissive * material.emissiveStrength;
  let emissiveTex = sampleEmissive(input.vUV).rgb;
  emissive *= pow(emissiveTex, vec3<f32>(2.2));
`,
    },
  },
  gl: {
    fragment: {
      material: /*glsl*/ `
  emissive = material.emissive * material.emissiveStrength;
  vec3 emissiveTex = sampleEmissive(vUV).rgb;
  emissive *= pow(emissiveTex, vec3(2.2));
`,
    },
  },
};
