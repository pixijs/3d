import type { ShaderBit } from '../ShaderBit';

/**
 * No-environment fallback
 *
 * Provides `sampleEnvironment(dir, roughness)` as a constant `vec3(0.0)`.
 * Selected automatically when `view3d.environment` is `null` or omitted.
 *
 * Substrate IBL diffuse and specular, clearcoat IBL, and sheen IBL all
 * collapse to zero, so materials are lit purely by direct lights and
 * emissive. The constant return is constant-folded through every consumer,
 * so downstream texture reads (BRDF LUT etc.) are dead code and eliminated
 * — no bindings, no texture reads, no ALU.
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
