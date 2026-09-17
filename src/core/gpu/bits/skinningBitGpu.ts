import { BoneMatrixStruct } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Skeletal animation for WebGPU using bone matrices stored in a storage buffer
 * @internal
 */
export const skinningBitGpu: ShaderBit = {
  name: 'skinning',
  attributes: {
    aJoints: 'uint8x4',
    aWeights: 'float32x4',
  },
  structs: {
    BoneMatrix: BoneMatrixStruct,
  },
  bindings: {
    global: {
      uBonePitStorage: 'storage<BoneMatrix>',
    },
  },
  gpu: {
    vertex: {
      header: `
        // Three rows of four, not a mat4: a bone matrix is affine, so its fourth row is
        // always (0, 0, 0, 1). Twelve floats instead of sixteen, and blending rows is a
        // quarter less work than blending mat4s.
        fn getBoneRows(idx: u32, bonePitIndex: u32) -> mat3x4<f32> {
            return uBonePitStorage[(bonePitIndex) + idx].rows;
        }
      `,
      input: `
        var skinRows =
            getBoneRows(input.aJoints.x, renderable.bonePitIndex) * input.aWeights.x +
            getBoneRows(input.aJoints.y, renderable.bonePitIndex) * input.aWeights.y +
            getBoneRows(input.aJoints.z, renderable.bonePitIndex) * input.aWeights.z +
            getBoneRows(input.aJoints.w, renderable.bonePitIndex) * input.aWeights.w;

        // Row-major affine: a point transform is three dot products, and the w the mat4
        // form would compute is always 1. Directions use the rows' xyz, so the
        // translation column drops out.
        position = vec4<f32>(dot(skinRows[0], position), dot(skinRows[1], position), dot(skinRows[2], position), position.w);
        normal = vec3<f32>(dot(skinRows[0].xyz, normal), dot(skinRows[1].xyz, normal), dot(skinRows[2].xyz, normal));
        tangent = vec3<f32>(dot(skinRows[0].xyz, tangent), dot(skinRows[1].xyz, tangent), dot(skinRows[2].xyz, tangent));
      `,
    },
  },
};
