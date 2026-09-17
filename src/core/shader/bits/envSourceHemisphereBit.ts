import type { ShaderBit } from '../ShaderBit';

/**
 * Hemisphere environment source
 *
 * Provides `sampleEnvironment(dir, roughness)` as a procedural sky/ground
 * gradient: `mix(groundColor, skyColor, dot(dir, up) * 0.5 + 0.5)`. Selected
 * automatically when `view3d.environment` is a {@link Hemisphere}.
 *
 * Roughness is unused — a hemisphere has no angular high-frequency detail
 * to filter. Pure ALU, no texture reads; the cheapest meaningful env
 * source and mobile-friendly by construction.
 *
 * Sky/ground colors are pre-multiplied by intensity and `up` is normalised
 * on the CPU side before upload, so the shader does no per-fragment
 * normalisation.
 * @internal
 */
export const envSourceHemisphereBit: ShaderBit = {
  name: 'envSourceHemisphere',

  gpu: {
    header: /*wgsl*/ `
fn sampleEnvironment(dir: vec3<f32>, roughness: f32) -> vec3<f32> {
  let t = dot(dir, global.uHemisphereUp) * 0.5 + 0.5;
  return mix(global.uHemisphereGround, global.uHemisphereSky, t);
}
`,
  },

  gl: {
    header: /*glsl*/ `
vec3 sampleEnvironment(vec3 dir, float roughness) {
  float t = dot(dir, uHemisphereUp) * 0.5 + 0.5;
  return mix(uHemisphereGround, uHemisphereSky, t);
}
`,
  },
};
