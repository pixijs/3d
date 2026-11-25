import { BoneMatrixStruct } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

function skinPosition(target: string, bonePitIndex: string): string {
  return `
        var skinRows =
            getBoneRows(input.aJoints.x, ${bonePitIndex}) * input.aWeights.x +
            getBoneRows(input.aJoints.y, ${bonePitIndex}) * input.aWeights.y +
            getBoneRows(input.aJoints.z, ${bonePitIndex}) * input.aWeights.z +
            getBoneRows(input.aJoints.w, ${bonePitIndex}) * input.aWeights.w;

        ${target} = vec4<f32>(dot(skinRows[0], ${target}), dot(skinRows[1], ${target}), dot(skinRows[2], ${target}), ${target}.w);`;
}

/**
 * WebGPU twin of `skinningBitGl`; normals take the bone rows, not their inverse transpose, so they
 * skew under a bone with non-uniform scale
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
      input: `${skinPosition('position', 'renderable.bonePitIndex')}
        normal = vec3<f32>(dot(skinRows[0].xyz, normal), dot(skinRows[1].xyz, normal), dot(skinRows[2].xyz, normal));
        tangent = vec3<f32>(dot(skinRows[0].xyz, tangent), dot(skinRows[1].xyz, tangent), dot(skinRows[2].xyz, tangent));
      `,
    },
  },
};

/**
 * Skins `previousPosition` with the previous render's bones; the material system adds it after `skinningBitGpu`,
 * whose attributes and `getBoneRows` it uses
 * @internal
 */
export const previousSkinningBitGpu: ShaderBit = {
  name: 'previousSkinning',
  gpu: {
    vertex: {
      input: `{${skinPosition('previousPosition', 'renderable.previousBonePitIndex')}
        }`,
    },
  },
};
