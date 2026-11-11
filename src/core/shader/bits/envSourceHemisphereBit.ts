import type { ShaderBit } from '../ShaderBit';

/** @internal */
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
