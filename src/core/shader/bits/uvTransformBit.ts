import type { ShaderBit } from '../ShaderBit';

/**
 * KHR_texture_transform shader bit
 *
 * Applies a 2x2 matrix + offset to mesh UVs once in the vertex shader so the
 * transformed UV is interpolated across the fragment — fragment-side mipmap
 * derivatives stay correct automatically.
 *
 * Adds two fields to the Material struct:
 *   - `uvTransformRow0: vec4<f32>` — [m00, m01, m10, m11], the row-major
 *     2x2 part of the affine. Built from Pixi's
 *     `new Matrix().scale().rotate().translate()` so that `(a, b, c, d)`
 *     map directly to `(m00, m01, m10, m11)`. This matches the de-facto
 *     KHR_texture_transform convention used by the glTF Sample Renderer
 *     (visual CCW rotation in y-down UV space).
 *   - `uvOffset: vec2<f32>` — translation (Pixi `tx`, `ty`)
 *
 * Identity default (row0 = [1,0,0,1], offset = [0,0]) is written by the
 * auto-generated sync function, so materials without a KHR_texture_transform
 * pass-through their UVs unchanged.
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
