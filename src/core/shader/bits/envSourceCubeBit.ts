import type { ShaderBit } from '../ShaderBit';

/** @internal */
export const envSourceCubeBit: ShaderBit = {
  name: 'envSourceCube',

  gpu: {
    header: /*wgsl*/ `
fn sampleEnvironment(dir: vec3<f32>, roughness: f32) -> vec3<f32> {
  let maxMip = f32(textureNumLevels(uEnvironmentTexture) - 1u);
  return textureSampleLevel(uEnvironmentTexture, uSampler, dir, roughness * maxMip).rgb;
}
`,
  },

  gl: {
    header: /*glsl*/ `
vec3 sampleEnvironment(vec3 dir, float roughness) {
  return textureLod(uEnvironmentTexture, dir, roughness * uEnvironmentMaxMipLevel).rgb;
}
`,
  },
};
