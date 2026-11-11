import type { BufferImageSource } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { BONE_MATRIX_FLOATS, BonePit } from '~/core/buffers/BonePit';
import { Skeleton } from '~/scene/Skeleton';

function skeleton(jointCount: number, x: number): Skeleton {
  const parent = new Int16Array(jointCount).fill(-1);
  const joints = new Int16Array(jointCount);
  const inverseBindMatrices = new Float32Array(jointCount * 16);
  for (let i = 0; i < jointCount; i++) {
    joints[i] = i;
    inverseBindMatrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], i * 16);
  }

  const result = new Skeleton({ parent, joints, inverseBindMatrices });
  for (let i = 0; i < jointCount; i++) result.localPosition[i * 3] = x;
  return result;
}

function frame(pit: BonePit, skeletons: Skeleton[]): void {
  pit.clear();
  for (const s of skeletons) {
    s.updateWorld();
    pit.add(s);
  }
  pit.update();
}

describe('BonePit upload', () => {
  it('skips the upload on a frame where no skeleton changed', () => {
    const pit = new BonePit({ initialBoneCapacity: 64 });
    const upload = vi.spyOn(pit.texture.source as BufferImageSource, 'update');
    const a = skeleton(2, 1);
    const b = skeleton(3, 2);

    try {
      frame(pit, [a, b]);
      frame(pit, [a, b]);
      expect(upload).toHaveBeenCalledTimes(1);

      b.dirty = true;
      frame(pit, [a, b]);
      expect(upload).toHaveBeenCalledTimes(2);
    } finally {
      pit.destroy();
    }
  });

  it('copies a returning skeleton whose base moved while it was away', () => {
    const pit = new BonePit({ initialBoneCapacity: 64 });
    const a = skeleton(2, 1);
    const b = skeleton(2, 2);
    const wide = skeleton(3, 3);

    try {
      frame(pit, [a, b]);
      frame(pit, [wide]);
      frame(pit, [wide, b]);

      const base = b._bonePitIndex * BONE_MATRIX_FLOATS;

      expect(b._bonePitIndex).toBe(3);
      expect(pit.data.subarray(base, base + b.worldMatrix.length)).toEqual(b.worldMatrix);
    } finally {
      pit.destroy();
    }
  });
});
