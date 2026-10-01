import { describe, expect, it } from 'vitest';

import { Container3D } from '~/scene/Container3D';
import { Skeleton } from '~/scene/Skeleton';

/** One root node that is also the only joint, with an identity inverse bind */
const oneBoneSkeleton = (): Skeleton =>
  new Skeleton({
    parent: new Int16Array([-1]),
    joints: new Int16Array([0]),
    inverseBindMatrices: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  });

const bonePosition = (skeleton: Skeleton): number[] =>
  Array.from(skeleton.localPosition.subarray(0, 3), (v) => Math.round(v * 1e6) / 1e6 + 0);

describe('Skeleton container bones', () => {
  it('moves the bone by the origin minus its turned image, as the scene graph does', () => {
    const skeleton = oneBoneSkeleton();
    const bone = new Container3D({
      position: { x: 10, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: Math.PI / 2 },
      origin: { x: 1, y: 0, z: 0 },
    });

    skeleton.bindContainerBone(0, bone);
    skeleton.updateWorld();

    expect(bonePosition(skeleton)).toEqual([11, -1, 0]);
    expect(bonePosition(skeleton)).toEqual(Array.from(bone.localTransform.elements.subarray(12, 15)));
  });

  it('follows a hidden bone, whose local matrix the transform pass skips', () => {
    const skeleton = oneBoneSkeleton();
    const bone = new Container3D({ visible: false });

    skeleton.bindContainerBone(0, bone);
    skeleton.updateWorld();

    bone.position.set(0, 3, 0);
    skeleton.updateWorld();

    expect(bonePosition(skeleton)).toEqual([0, 3, 0]);
  });
});
