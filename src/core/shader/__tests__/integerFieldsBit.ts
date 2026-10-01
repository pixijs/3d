import type { ShaderBit } from '../ShaderBit';

/** Sets albedo's red channel when the `u32` field reads 3, and its green channel when the `i32` field reads -2 */
export const integerFieldsBit: ShaderBit = {
  name: 'integerFieldsTest',
  bindings: { material: { flags: 'u32', offset: 'i32' } },
  gpu: {
    fragment: {
      material: /* wgsl */ `
  albedo = vec3<f32>(select(0.0, 1.0, material.flags == 3u), select(0.0, 1.0, material.offset == -2), 0.0);
`,
    },
  },
  gl: {
    fragment: {
      material: /* glsl */ `
  albedo = vec3(material.flags == 3u ? 1.0 : 0.0, material.offset == -2 ? 1.0 : 0.0, 0.0);
`,
    },
  },
};
