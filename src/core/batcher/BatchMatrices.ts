import { MESH3D_STORE_STRIDE } from '../buffers/Mesh3DDataStoreBuffer';
import type { Mesh3DBatch } from './Mesh3DBatch';

/**
 * The slot matrices of a {@link BatchedMesh3D} as one float array, for rewriting many slots a frame
 *
 * Slot `i`'s matrix is the 16 floats from `offset + i * stride`, column-major and affine, as
 * {@link BatchedMesh3D.setMatrixAt | setMatrixAt} takes it. Call {@link BatchMatrices.update | update}
 * once you're done, or the writes may never be uploaded:
 *
 * ```ts
 * const { data, stride, offset } = batched.matrices;
 *
 * for (let i = 0, o = offset; i < batched.size; i++, o += stride) {
 *   // Rotation and scale live in 0-2, 4-6 and 8-10; translation in 12-14.
 *   data[o + 12] = x[i];
 *   data[o + 13] = y[i];
 *   data[o + 14] = z[i];
 * }
 *
 * batched.matrices.update();
 * ```
 *
 * A new slot's matrix is all zeros, so set each full matrix once before writing only the lanes that
 * move. Write only a slot's 16 floats: the floats between matrices hold engine data, such as the
 * slot's material and visibility. Read `stride` and `offset` rather than hard-coding them, since the
 * layout can change between releases.
 * @category scene
 * @advanced
 */
export class BatchMatrices {
  /** Floats from one slot's matrix to the next in {@link BatchMatrices.data | data} */
  public readonly stride: number = MESH3D_STORE_STRIDE;
  /** Float index of slot 0's matrix in {@link BatchMatrices.data | data} */
  public readonly offset: number = 0;

  private readonly _batch: Mesh3DBatch;
  private readonly _baseIndex: number = 0;

  /** @internal */
  constructor(batch: Mesh3DBatch, baseIndex: number) {
    this._batch = batch;
    this._baseIndex = baseIndex;
    this.offset = baseIndex * MESH3D_STORE_STRIDE;
  }

  /** The float array holding every slot's matrix; it stays valid across `unload()`, but not past `destroy()` */
  public get data(): Float32Array {
    return this._batch.storeBuffer.data;
  }

  /**
   * Uploads the matrices written through {@link BatchMatrices.data | data} on the next render, for
   * drawing, culling and shadows alike
   *
   * Pass the range that changed, or nothing for every slot. Throws a `RangeError` for a range outside
   * the batch. The next render then uploads every matrix from slot 0 to the end of the range in one
   * go, so for a few scattered slots use `setMatrixAt` alone.
   * @param first - The first slot that changed
   * @param count - How many slots changed; defaults to every slot from `first` on
   */
  public update(first = 0, count = this._batch.items.length - first): void {
    const batch = this._batch;
    const items = batch.items;
    if (!(first >= 0 && count >= 0 && first + count <= items.length)) {
      throw new RangeError(
        `update: slots ${first} to ${first + count - 1} are outside the batch (${items.length} slots).`,
      );
    }
    if (count === 0) return;

    const base = this._baseIndex + first;
    batch.storeBuffer.markDirtyRange(base, base + count - 1);

    if (batch.storeBuffer.writesSpheres) {
      for (let i = first, end = first + count; i < end; i++) batch._writeSlotSphere(i);
    }
  }

  /** @internal */
  public destroy(): void {
    (this._batch as Mesh3DBatch | null) = null;
  }
}
