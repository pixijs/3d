import type { ShaderBit } from '../ShaderBit';

/**
 * The environment for a `CubeTexture`: `sampleEnvironment(dir, roughness)` reads the prefiltered
 * cubemap `uEnvironmentTexture`
 *
 * The view picks it when `view3d.environment` is a `CubeTexture`. The cube's mips hold the
 * environment blurred for rising roughness, and `roughness * maxMip` picks the level, so
 * `roughness = 1` reads the blurriest mip, which diffuse lighting uses as its irradiance. The cube
 * was decoded to linear when it was prefiltered, so the sample is returned as it is.
 *
 * WGSL reads the mip count with `textureNumLevels`. GLSL ES 3.00 has no such query, so WebGL reads
 * `uEnvironmentMaxMipLevel`, which the pipe sets to the mip count minus one.
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
