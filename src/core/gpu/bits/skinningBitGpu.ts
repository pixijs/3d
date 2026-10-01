import { BoneMatrixStruct } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Skeletal animation for WebGPU: blends up to four bone matrices per vertex from the view's bone
 * pit, `uBonePitStorage`, starting at the mesh's `renderable.bonePitIndex`
 *
 * A bone matrix is affine, so its fourth row is always `(0, 0, 0, 1)` and the pit stores only the
 * other three (`BoneMatrixStruct`): twelve floats instead of sixteen, and a quarter less work to
 * blend. A point then transforms with three dot products and keeps its `w` of 1. A normal or
 * tangent uses the rows' `xyz`, so the translation drops out. Normals take the rows as they are,
 * not their inverse transpose, so they skew under a bone with non-uniform scale.
 *
 * Runs in `vertexInput` after the position bit and the morph bit, so it skins the decoded,
 * morphed position. `skinningBitGl` is the WebGL twin.
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

        position = vec4<f32>(dot(skinRows[0], position), dot(skinRows[1], position), dot(skinRows[2], position), position.w);
        normal = vec3<f32>(dot(skinRows[0].xyz, normal), dot(skinRows[1].xyz, normal), dot(skinRows[2].xyz, normal));
        tangent = vec3<f32>(dot(skinRows[0].xyz, tangent), dot(skinRows[1].xyz, tangent), dot(skinRows[2].xyz, tangent));
      `,
    },
  },
};
