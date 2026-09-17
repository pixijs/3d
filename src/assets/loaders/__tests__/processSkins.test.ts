import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { processSkins } from '~/assets/loaders/gltf/process/processSkins';
import type { Scene3DDescriptor, Scene3DNode } from '~/assets/Scene3DDescriptor';

// Builds a tightly-packed MAT4 inverse-bind-matrix accessor (identity per joint)
// plus the accessor/bufferView metadata `getBuffer` reads, and the backing buffer
// passed to `processSkins` as its `buffers` argument.
function identityIbm(jointCount: number): {
  accessors: GltfFormat['accessors'];
  bufferViews: GltfFormat['bufferViews'];
  buffer: ArrayBuffer;
} {
  const data = new Float32Array(jointCount * 16);

  for (let j = 0; j < jointCount; j++) {
    const m = j * 16;

    data[m] = data[m + 5] = data[m + 10] = data[m + 15] = 1;
  }

  return {
    accessors: [{ bufferView: 0, componentType: 5126, type: 'MAT4', count: jointCount }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: data.byteLength }],
    buffer: data.buffer,
  };
}

// Empty descriptor nodes (label/children only) for `processSkins` to tag with isJoint.
function descriptorNodes(labels: string[]): Scene3DNode[] {
  return labels.map((label) => ({ label, children: [] }));
}

describe('processSkins', () => {
  it('keeps a mesh-anchoring ancestor out of the joint set and still marks pure bones', () => {
    // Skeleton-less skin (no glTF `skeleton`). `Armature` anchors the skinned mesh
    // `char`, while `Hips`/`Spine` are pure bones. collectSkeletonNodes sweeps the
    // joints' shared ancestor `Armature` in, but it must stay in the scene graph
    // because its subtree contains a renderable mesh.
    const ibm = identityIbm(2);
    const gltfRaw: GltfFormat = {
      asset: { version: '2.0' },
      nodes: [
        { name: 'Armature', children: [1, 2] },
        { name: 'char', mesh: 0 },
        { name: 'Hips', children: [3] },
        { name: 'Spine' },
      ],
      skins: [{ joints: [2, 3], inverseBindMatrices: 0 }],
      accessors: ibm.accessors,
      bufferViews: ibm.bufferViews,
    };

    const descriptor: Scene3DDescriptor = {
      nodes: descriptorNodes(['Armature', 'char', 'Hips', 'Spine']),
    };

    processSkins(gltfRaw, [ibm.buffer], descriptor);

    const skin = descriptor.skins![0];

    expect(skin.skeletonToModelRoot).toBe(true);
    // Ancestors of the joints, ordered by depth.
    expect(Array.from(skin.skeletonNodes)).toEqual([0, 2, 3]);

    // Armature anchors a mesh -> kept in the scene graph (not a joint).
    expect(descriptor.nodes![0].isJoint).toBeFalsy();
    // Pure bones -> marked as joints.
    expect(descriptor.nodes![2].isJoint).toBe(true);
    expect(descriptor.nodes![3].isJoint).toBe(true);
    // The mesh node itself is not part of the skeleton and is untouched.
    expect(descriptor.nodes![1].isJoint).toBeFalsy();
  });

  it('marks every collected node as a joint when no node in the chain anchors a mesh', () => {
    const ibm = identityIbm(1);
    const gltfRaw: GltfFormat = {
      asset: { version: '2.0' },
      nodes: [{ name: 'Root', children: [1] }, { name: 'Bone' }],
      skins: [{ joints: [1], inverseBindMatrices: 0 }],
      accessors: ibm.accessors,
      bufferViews: ibm.bufferViews,
    };

    const descriptor: Scene3DDescriptor = { nodes: descriptorNodes(['Root', 'Bone']) };

    processSkins(gltfRaw, [ibm.buffer], descriptor);

    expect(descriptor.nodes![0].isJoint).toBe(true);
    expect(descriptor.nodes![1].isJoint).toBe(true);
  });

  it('reports skeletonToModelRoot=false when the skin specifies a skeleton root', () => {
    const ibm = identityIbm(1);
    const gltfRaw: GltfFormat = {
      asset: { version: '2.0' },
      nodes: [{ name: 'SkelRoot', children: [1] }, { name: 'Bone' }],
      skins: [{ joints: [1], skeleton: 0, inverseBindMatrices: 0 }],
      accessors: ibm.accessors,
      bufferViews: ibm.bufferViews,
    };

    const descriptor: Scene3DDescriptor = { nodes: descriptorNodes(['SkelRoot', 'Bone']) };

    processSkins(gltfRaw, [ibm.buffer], descriptor);

    expect(descriptor.skins![0].skeletonToModelRoot).toBe(false);
  });
});
