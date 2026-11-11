import { describe, expect, it } from 'vitest';

import { Mesh3DBatch } from '~/core/batcher/Mesh3DBatch';
import { MESH3D_STORE_STRIDE } from '~/core/buffers/Mesh3DDataStoreBuffer';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { Quaternion } from '~/math/rotation/Quaternion';
import { Vector3 } from '~/math/vector/Vector3';

const SIZE = 6;

const matrixFor = (i: number, out = new Matrix4()) =>
  out.compose(
    new Vector3(i * 1.5 - 3, i * -0.25, i * i),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), i * 0.7),
    new Vector3(1 + i * 0.1, 2, 0.5 + i),
  );

const storeBits = (batch: Mesh3DBatch) =>
  Array.from(batch.storeBuffer.u32Data.subarray(0, (SIZE + 1) * MESH3D_STORE_STRIDE));

const writtenPerSlot = (pairs: [slot: number, source: number][]) => {
  const batch = new Mesh3DBatch({ size: SIZE });
  const matrix = new Matrix4();
  for (const [slot, source] of pairs) batch.setMatrixAt(slot, matrixFor(source, matrix));
  return batch;
};

type DirtyRange = { _dirty: { min: number; max: number }; update(): void };

describe('BatchMatrices', () => {
  it('releases a retained matrix handle when the batch is destroyed', () => {
    const batch = new Mesh3DBatch({ size: SIZE });
    const matrices = batch.matrices;

    batch.destroy();
    batch.destroy();

    expect((matrices as unknown as { _batch: unknown })._batch).toBeNull();
  });

  describe('data + update', () => {
    it('matrices written in place land where setMatrixAt puts them', () => {
      const reference = writtenPerSlot([0, 1, 2, 3, 4, 5].map((i) => [i, i]));
      const batch = new Mesh3DBatch({ size: SIZE });
      const matrix = new Matrix4();

      const { data, stride, offset } = batch.matrices;
      for (let i = 0, o = offset; i < SIZE; i++, o += stride) data.set(matrixFor(i, matrix).elements, o);
      batch.matrices.update();

      expect(storeBits(batch)).toEqual(storeBits(reference));
    });

    it('queues exactly the run it is given for upload', () => {
      const batch = new Mesh3DBatch({ size: SIZE });
      const store = batch.storeBuffer as unknown as DirtyRange;
      store.update();
      expect(store._dirty.min, "the allocation's own dirty range is flushed").toBeGreaterThan(store._dirty.max);

      batch.matrices.update(2, 3);

      const firstRow = batch.matrices.offset / batch.matrices.stride;
      expect(store._dirty.min).toBe(firstRow + 2);
      expect(store._dirty.max).toBe(firstRow + 4);
    });

    it('defaults to every slot from `first` on', () => {
      const batch = new Mesh3DBatch({ size: SIZE });
      const store = batch.storeBuffer as unknown as DirtyRange;
      store.update();

      batch.matrices.update(4);

      const firstRow = batch.matrices.offset / batch.matrices.stride;
      expect(store._dirty.min).toBe(firstRow + 4);
      expect(store._dirty.max).toBe(firstRow + SIZE - 1);
    });

    it('throws when the run does not fit the batch', () => {
      const batch = new Mesh3DBatch({ size: SIZE });
      expect(() => batch.matrices.update(SIZE - 1, 2)).toThrow(RangeError);
      expect(() => batch.matrices.update(-1)).toThrow(RangeError);
    });
  });
});
