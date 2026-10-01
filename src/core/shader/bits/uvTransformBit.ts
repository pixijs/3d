import type { ShaderBit } from '../ShaderBit';

/**
 * Applies the material's {@link BaseMaterial3D#uvTransform} to the mesh UVs, in the vertex shader
 *
 * The fragment stage interpolates the transformed UV like any other, so mip selection needs nothing
 * extra. One transform covers every texture of the material.
 *
 * It adds two `Material` fields from the transform matrix: `uvTransformRow0`, its `(a, b, c, d)`,
 * and `uvOffset`, its `(tx, ty)`. A UV `(u, v)` becomes `(a * u + b * v + tx, c * u + d * v + ty)`.
 * The material starts them at the identity, so with no transform the UVs pass through unchanged.
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
