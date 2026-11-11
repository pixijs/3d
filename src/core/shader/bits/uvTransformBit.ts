import type { ShaderBit } from '../ShaderBit';

/**
 * Applies the material's {@link BaseMaterial3D#uvTransform} to the mesh UVs
 *
 * List it in a custom material's bits for `uvTransform` to work there.
 * @category rendering
 * @advanced
 */
export const uvTransformBit: ShaderBit = {
  name: 'uvTransform',

  bindings: {
    material: {
      uvOffset: 'vec2<f32>',
      uvTransformRow0: 'vec4<f32>',
    },
  },

  gpu: {
    vertex: {
      end: /*wgsl*/ `
  let m = material.uvTransformRow0;
  uv = vec2<f32>(m.x * uv.x + m.y * uv.y,
                 m.z * uv.x + m.w * uv.y) + material.uvOffset;
`,
    },
  },

  gl: {
    vertex: {
      end: /*glsl*/ `
  vec4 m = material.uvTransformRow0;
  uv = vec2(m.x * uv.x + m.y * uv.y,
            m.z * uv.x + m.w * uv.y) + material.uvOffset;
`,
    },
  },
};
