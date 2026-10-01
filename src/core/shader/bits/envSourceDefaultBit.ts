import type { ShaderBit } from '../ShaderBit';

/**
 * The environment when there is none: `sampleEnvironment(dir, roughness)` returns zero
 *
 * The view picks it when `view3d.environment` is `null`. Every environment term then comes out as
 * zero, so materials are lit by their lights and emissive alone.
 *
 * The zero keeps callers correct, not free. A compiler may not drop `x * 0.0`, which isn't zero
 * when `x` is NaN or infinite, so whatever a caller fetches and computes on the way may still run.
 * A material with an expensive environment block leaves it out of the shader instead, as
 * `Material3D` does with `iblBit`.
 *
 * For a soft, even ambient, assign a {@link Hemisphere} with the same sky and ground colour.
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
