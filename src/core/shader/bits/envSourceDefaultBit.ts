import type { ShaderBit } from '../ShaderBit';

/** @internal */
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
