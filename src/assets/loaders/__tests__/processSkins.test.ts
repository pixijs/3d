import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { processSkins } from '~/assets/loaders/gltf/process/processSkins';
import type { Scene3DDescriptor, Scene3DNode } from '~/assets/Scene3DDescriptor';

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

function descriptorNodes(labels: string[]): Scene3DNode[] {
  return labels.map((label) => ({ label, children: [] }));
}

describe('processSkins', () => {
  it('stops the skeleton below the node above its joints, which becomes the parent node', () => {
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

    expect(Array.from(skin.skeletonNodes)).toEqual([2, 3]);
    expect(skin.parentNode).toBe(0);

    expect(descriptor.nodes![0].isJoint).toBeFalsy();
    expect(descriptor.nodes![2].isJoint).toBe(true);
    expect(descriptor.nodes![3].isJoint).toBe(true);
    expect(descriptor.nodes![1].isJoint).toBeFalsy();
  });

  it('keeps a node between two joints in the skeleton, and out of the joints when it holds a mesh', () => {
    const ibm = identityIbm(2);
    const gltfRaw: GltfFormat = {
      asset: { version: '2.0' },
      nodes: [
        { name: 'Arm', children: [1] },
        { name: 'Wrist', children: [2, 3] },
        { name: 'Hand' },
        { name: 'sword', mesh: 0 },
      ],
      skins: [{ joints: [0, 2], inverseBindMatrices: 0 }],
      accessors: ibm.accessors,
      bufferViews: ibm.bufferViews,
    };

    const descriptor: Scene3DDescriptor = { nodes: descriptorNodes(['Arm', 'Wrist', 'Hand', 'sword']) };

    processSkins(gltfRaw, [ibm.buffer], descriptor);

    const skin = descriptor.skins![0];

    expect(Array.from(skin.skeletonNodes)).toEqual([0, 1, 2]);
    expect(skin.parentNode).toBe(-1);
    expect(descriptor.nodes![0].isJoint, 'a prop hangs below it').toBeFalsy();
    expect(descriptor.nodes![1].isJoint).toBeFalsy();
    expect(descriptor.nodes![2].isJoint).toBe(true);
  });

  it("ignores the skin's skeleton property", () => {
    const ibm = identityIbm(1);
    const gltfRaw: GltfFormat = {
      asset: { version: '2.0' },
      nodes: [{ name: 'Scene', children: [1] }, { name: 'Armature', children: [2] }, { name: 'Bone' }],
      skins: [{ joints: [2], skeleton: 0, inverseBindMatrices: 0 }],
      accessors: ibm.accessors,
      bufferViews: ibm.bufferViews,
    };

    const descriptor: Scene3DDescriptor = { nodes: descriptorNodes(['Scene', 'Armature', 'Bone']) };

    processSkins(gltfRaw, [ibm.buffer], descriptor);

    expect(Array.from(descriptor.skins![0].skeletonNodes)).toEqual([2]);
    expect(descriptor.skins![0].parentNode).toBe(1);
    expect(descriptor.nodes![1].isJoint, 'the parent node stays in the scene graph').toBeFalsy();
  });

  it('takes the lowest node above every joint when the joints sit on two branches', () => {
    const ibm = identityIbm(2);
    const gltfRaw: GltfFormat = {
      asset: { version: '2.0' },
      nodes: [
        { name: 'Scene', children: [1] },
        { name: 'Armature', children: [2, 3] },
        { name: 'Left', children: [4] },
        { name: 'Right', children: [5] },
        { name: 'LeftBone' },
        { name: 'RightBone' },
      ],
      skins: [{ joints: [4, 5], inverseBindMatrices: 0 }],
      accessors: ibm.accessors,
      bufferViews: ibm.bufferViews,
    };

    const descriptor: Scene3DDescriptor = {
      nodes: descriptorNodes(['Scene', 'Armature', 'Left', 'Right', 'LeftBone', 'RightBone']),
    };

    processSkins(gltfRaw, [ibm.buffer], descriptor);

    expect(descriptor.skins![0].parentNode).toBe(1);
    expect(Array.from(descriptor.skins![0].skeletonNodes)).toEqual([2, 3, 4, 5]);
    expect(Array.from(descriptor.skins![0].skeletonParent)).toEqual([-1, -1, 0, 1]);
  });

  it("moves the parent node above another skin's joints, so it is a node the model builds", () => {
    const ibm = identityIbm(2);
    const gltfRaw: GltfFormat = {
      asset: { version: '2.0' },
      nodes: [
        { name: 'Armature', children: [1, 3, 4] },
        { name: 'Hips', children: [2] },
        { name: 'Head' },
        { name: 'body', mesh: 0, skin: 1 },
        { name: 'hat', mesh: 0, skin: 0 },
      ],
      skins: [
        { joints: [2], inverseBindMatrices: 0 },
        { joints: [1, 2], inverseBindMatrices: 0 },
      ],
      accessors: ibm.accessors,
      bufferViews: ibm.bufferViews,
    };

    const descriptor: Scene3DDescriptor = { nodes: descriptorNodes(['Armature', 'Hips', 'Head', 'body', 'hat']) };

    processSkins(gltfRaw, [ibm.buffer], descriptor);

    const hat = descriptor.skins![0];

    expect(hat.parentNode).toBe(0);
    expect(Array.from(hat.skeletonNodes)).toEqual([1, 2]);
    expect(Array.from(hat.skeletonJoints)).toEqual([1]);
  });

  it('keeps one skin for skins with the same nodes and inverse binds, and points their nodes at it', () => {
    const data = new Float32Array(32);

    data[0] = data[5] = data[10] = data[15] = 1;
    data.copyWithin(16, 0, 16);

    const gltfRaw: GltfFormat = {
      asset: { version: '2.0' },
      nodes: [{ name: 'body', mesh: 0, skin: 0 }, { name: 'hat', mesh: 0, skin: 1 }, { name: 'Hips' }],
      skins: [
        { joints: [2], inverseBindMatrices: 0 },
        { joints: [2], inverseBindMatrices: 1 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, type: 'MAT4', count: 1 },
        { bufferView: 1, componentType: 5126, type: 'MAT4', count: 1 },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 64 },
        { buffer: 0, byteOffset: 64, byteLength: 64 },
      ],
    };

    const descriptor: Scene3DDescriptor = {
      nodes: [
        { label: 'body', children: [], skin: 0 },
        { label: 'hat', children: [], skin: 1 },
        { label: 'Hips', children: [] },
      ],
    };

    processSkins(gltfRaw, [data.buffer], descriptor);

    expect(descriptor.skins).toHaveLength(1);
    expect(descriptor.nodes![0].skin).toBe(0);
    expect(descriptor.nodes![1].skin).toBe(0);

    data[16 + 12] = 1;
    descriptor.nodes![1].skin = 1;
    processSkins(gltfRaw, [data.buffer], descriptor);

    expect(descriptor.skins, 'skins whose inverse binds differ stay apart').toHaveLength(2);
    expect(descriptor.nodes![1].skin).toBe(1);
  });

  it('points a distinct skin after a collapsed pair at its new index', () => {
    const ibm = identityIbm(1);
    const gltfRaw: GltfFormat = {
      asset: { version: '2.0' },
      nodes: [
        { name: 'body', mesh: 0, skin: 0 },
        { name: 'hat', mesh: 0, skin: 1 },
        { name: 'Hips' },
        { name: 'prop', mesh: 0, skin: 2 },
        { name: 'Handle' },
      ],
      skins: [
        { joints: [2], inverseBindMatrices: 0 },
        { joints: [2], inverseBindMatrices: 0 },
        { joints: [4], inverseBindMatrices: 0 },
      ],
      accessors: ibm.accessors,
      bufferViews: ibm.bufferViews,
    };

    const descriptor: Scene3DDescriptor = {
      nodes: [
        { label: 'body', children: [], skin: 0 },
        { label: 'hat', children: [], skin: 1 },
        { label: 'Hips', children: [] },
        { label: 'prop', children: [], skin: 2 },
        { label: 'Handle', children: [] },
      ],
    };

    processSkins(gltfRaw, [ibm.buffer], descriptor);

    expect(descriptor.skins).toHaveLength(2);
    expect(descriptor.nodes![0].skin).toBe(0);
    expect(descriptor.nodes![1].skin).toBe(0);
    expect(descriptor.nodes![3].skin).toBe(1);
  });

  describe('bindShapeMatrix', () => {
    function bindShapeOf(arm: Partial<Scene3DNode>, bone: Partial<Scene3DNode>, ibm: Float32Array) {
      const gltfRaw: GltfFormat = {
        asset: { version: '2.0' },
        nodes: [{ name: 'Armature', children: [1] }, { name: 'Arm', children: [2] }, { name: 'Bone' }],
        skins: [{ joints: [2, 1], inverseBindMatrices: 0 }],
        accessors: [{ bufferView: 0, componentType: 5126, type: 'MAT4', count: 2 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 128 }],
      };
      const descriptor: Scene3DDescriptor = {
        nodes: [
          { label: 'Armature', children: [1], position: new Float32Array([9, 9, 9]) },
          { label: 'Arm', children: [2], ...arm },
          { label: 'Bone', children: [], ...bone },
        ],
      };
      const data = new Float32Array(32);

      data.set(ibm, 0);
      data.set(identity(), 16);

      processSkins(gltfRaw, [data.buffer], descriptor);

      return descriptor.skins![0].bindShapeMatrix;
    }

    const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    it('is absent when the rest pose and the inverse bind cancel', () => {
      const ibm = identity();

      ibm[12] = -10;

      expect(bindShapeOf({ position: new Float32Array([10, 0, 0]) }, {}, ibm)).toBeUndefined();
    });

    it('is absent when a rotated rest pose and its inverse bind cancel to within float noise', () => {
      const turn = 0.7;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);

      const ibm = new Float32Array([cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, 0.9999999, 0, 0, 0, 0, 1]);

      expect(
        bindShapeOf({ rotation: new Float32Array([0, 0, Math.sin(turn / 2), Math.cos(turn / 2)]) }, {}, ibm),
      ).toBeUndefined();
    });

    it('keeps an offset larger than float noise', () => {
      const ibm = identity();

      ibm[12] = 0.001;

      expect(bindShapeOf({}, {}, ibm)![12]).toBeCloseTo(0.001, 6);
    });

    it("is the first joint's rest matrix below the parent node times its inverse bind", () => {
      const ibm = identity();

      ibm[0] = ibm[5] = ibm[10] = 100;

      const matrix = bindShapeOf(
        { position: new Float32Array([1, 2, 3]) },
        { position: new Float32Array([4, 0, 0]) },
        ibm,
      )!;

      expect(Array.from(matrix), "the parent node's own position stays out").toEqual([
        100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 5, 2, 3, 1,
      ]);
    });

    it('drops shear, so a mesh can hold it as a position, rotation and scale', () => {
      const turn = Math.PI / 8;
      const matrix = bindShapeOf(
        { scale: new Float32Array([1, 3, 1]) },
        { rotation: new Float32Array([0, 0, Math.sin(turn), Math.cos(turn)]) },
        identity(),
      )!;

      const xAxis = [matrix[0], matrix[1], matrix[2]];
      const yAxis = [matrix[4], matrix[5], matrix[6]];

      expect(xAxis[0] * yAxis[0] + xAxis[1] * yAxis[1] + xAxis[2] * yAxis[2]).toBeCloseTo(0, 5);
    });

    it('is absent when the inverse bind is all zeros, which has no inverse', () => {
      expect(bindShapeOf({}, {}, new Float32Array(16))).toBeUndefined();
    });
  });
});
