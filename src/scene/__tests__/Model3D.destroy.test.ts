import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AnimationPlayer } from '~/animation/AnimationPlayer';
import { Scene3DSource } from '~/assets/Scene3DSource';
import { Model3D } from '~/scene/Model3D';
import { Skeleton } from '~/scene/Skeleton';

const emptySource = new Scene3DSource({});

function createSkeleton(): Skeleton {
  return new Skeleton({
    parent: new Int16Array([-1, 0]),
    joints: new Int16Array([1]),
    inverseBindMatrices: new Float32Array(16),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Model3D destroy', () => {
  it('destroys the player, every skeleton, marks itself destroyed, and leaves the source intact', () => {
    const model = new Model3D(emptySource);

    const skeleton = createSkeleton();
    const skeletonDestroy = vi.spyOn(skeleton, 'destroy');

    model.skeletons.push(skeleton);

    const playerDestroy = vi.fn<() => void>();

    model.player = { destroy: playerDestroy } as unknown as AnimationPlayer;

    model.destroy();

    expect(playerDestroy).toHaveBeenCalledTimes(1);
    expect(skeletonDestroy).toHaveBeenCalledTimes(1);
    expect(model.skeletons).toBeNull();
    expect(model.player).toBeUndefined();
    expect(model.destroyed).toBe(true);
    expect(model.source).toBe(emptySource);
  });

  it('is idempotent — a second destroy does not re-run player or skeleton teardown', () => {
    const model = new Model3D(emptySource);

    const skeleton = createSkeleton();
    const skeletonDestroy = vi.spyOn(skeleton, 'destroy');

    model.skeletons.push(skeleton);

    const playerDestroy = vi.fn<() => void>();

    model.player = { destroy: playerDestroy } as unknown as AnimationPlayer;

    model.destroy();

    expect(() => model.destroy()).not.toThrow();
    expect(playerDestroy).toHaveBeenCalledTimes(1);
    expect(skeletonDestroy).toHaveBeenCalledTimes(1);
    expect(model.destroyed).toBe(true);
  });
});
