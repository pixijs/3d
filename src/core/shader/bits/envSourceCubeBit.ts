import type { ShaderBit } from '../ShaderBit';

/**
 * Cubemap environment source
 *
 * Provides `sampleEnvironment(dir, roughness)` backed by a prefiltered IBL
 * cubemap (`uEnvironmentTexture`). Selected automatically when
 * `view3d.environment` is a `CubeTexture`.
 *
 * `sampleEnvironment` returns linear radiance: the prefiltered cube is already
 * linear (sRGB decode happens once, at prefilter time), so the runtime sample
 * is returned directly. Roughness picks the prefiltered mip via
 * `roughness * maxMip`; `roughness = 1.0` lands on the highest mip, used by the
 * substrate diffuse path as a cheap irradiance approximation.
 *
 * The max-mip level is read via `textureNumLevels()` where available and
 * via the `uEnvironmentMaxMipLevel` uniform otherwise.
 * @internal
 */
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
