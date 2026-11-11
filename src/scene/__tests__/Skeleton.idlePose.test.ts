import { describe, expect, it } from 'vitest';

import { Container3D } from '~/scene/Container3D';
import { Skeleton } from '~/scene/Skeleton';

function createBoundRig(): { skeleton: Skeleton; bone: Container3D } {
  const skeleton = new Skeleton({
    parent: new Int16Array([-1]),
    joints: new Int16Array([0]),
    inverseBindMatrices: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  });
  const bone = new Container3D();

  skeleton.bindContainerBone(0, bone);

  return { skeleton, bone };
}

const MARKER = 7;

const X_TRANSLATION_SLOT = 3;

describe('Skeleton with a container-bound bone', () => {
  it.each([
    {
      name: 'rotation',
      pose: (bone: Container3D) => bone.quaternion.set(0, Math.sin(0.15), 0, Math.cos(0.15)),
    },
    { name: 'scale', pose: (bone: Container3D) => bone.scale.set(1.1, 1.1, 1.1) },
    { name: 'position', pose: (bone: Container3D) => bone.position.set(0.1, 0, 0) },
  ])('skips the rebuild when a still bone has a $name that float32 cannot hold exactly', ({ pose }) => {
    const { skeleton, bone } = createBoundRig();

    pose(bone);
    skeleton.updateWorld();
    skeleton.worldMatrix[0] = MARKER;
    skeleton.updateWorld();

    expect(skeleton.worldMatrix[0]).toBe(MARKER);
  });

  it('rebuilds when the bone moves between updates', () => {
    const { skeleton, bone } = createBoundRig();

    skeleton.updateWorld();
    bone.position.x = 2;
    skeleton.updateWorld();

    expect(skeleton.worldMatrix[X_TRANSLATION_SLOT]).toBe(2);
  });
});
