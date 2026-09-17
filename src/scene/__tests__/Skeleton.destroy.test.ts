import { afterEach, describe, expect, it, vi } from 'vitest';

import { Skeleton } from '~/scene/Skeleton';

function createSkeleton(): Skeleton {
  // Minimal rig: 2 nodes (root + one joint), 1 skinning joint.
  return new Skeleton({
    parent: new Int16Array([-1, 0]),
    joints: new Int16Array([1]),
    inverseBindMatrices: new Float32Array(16),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Skeleton destroy', () => {
  it('releases the bone-pit reservation and drops container bones', () => {
    const skeleton = createSkeleton();

    skeleton.destroy();

    expect(skeleton._bonePitIndex).toBe(-1);
    expect(skeleton._bonePitTick).toBe(-1);
  });

  it('is idempotent — a second destroy is a no-op', () => {
    const skeleton = createSkeleton();

    skeleton.destroy();

    expect(() => skeleton.destroy()).not.toThrow();
    expect(skeleton._bonePitIndex).toBe(-1);
  });
});
