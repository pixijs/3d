import type { ShaderBit } from '../ShaderBit';

/**
 * No-environment fallback
 *
 * Provides `sampleEnvironment(dir, roughness)` as a constant `vec3(0.0)`.
 * Selected automatically when `view3d.environment` is `null` or omitted.
 *
 * Every environment term a material adds comes out as zero, so materials are
 * lit purely by direct lights and emissive. The zero keeps a caller correct,
 * not free: a shader compiler is not required to drop `x * 0.0` (it is not
 * zero when `x` is NaN or infinite), so whatever a caller fetches and
 * computes on the way to that product may still run. A material whose
 * environment block is expensive leaves it out of the shader instead, as
 * `Material3D` does with `iblBit`.
 *
 * For a soft uniform ambient instead, assign a {@link Hemisphere} with
 * matching sky and ground colors.
 * @internal
 */
export const envSourceDefaultBit: ShaderBit = {
  name: 'envSourceDefault',

  gpu: {
    header: /*wgsl*/ `
fn sampleEnvironment(dir: vec3<f32>, roughness: f32) -> vec3<f32> {
  return vec3<f32>(0.0);
}
`,
  },

  gl: {
    header: /*glsl*/ `
vec3 sampleEnvironment(vec3 dir, float roughness) {
  return vec3(0.0);
}
`,
  },
};
