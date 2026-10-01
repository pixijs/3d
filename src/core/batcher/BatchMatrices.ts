import { MESH3D_STORE_STRIDE } from '../buffers/Mesh3DDataStoreBuffer';
import type { Mesh3DBatch } from './Mesh3DBatch';
import type { Mesh3DSlot } from './Mesh3DSlot';

/**
 * The slot matrices of a {@link BatchedMesh3D}, exposed as interleaved data for bulk writes
 *
 * Reached through {@link BatchedMesh3D.matrices}. {@link BatchedMesh3D.setMatrixAt | setMatrixAt}
 * copies a `Matrix4` into the batch one slot at a time. Code that rewrites many slots a frame can
 * skip both the `Matrix4` and the copy by computing its transforms straight into
 * {@link BatchMatrices.data | data}. Slot `i`'s matrix is the 16
 * floats starting at `offset + i * stride`. It is column-major and affine, the same contract as
 * `setMatrixAt`. Call {@link BatchMatrices.update | update} once you are done, or nothing is
 * uploaded:
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
 * A new slot's matrix is all zeros. Initialize each full matrix through `setMatrixAt` or here
 * before writing only the lanes that move.
 *
 * > [!WARNING] The floats between one matrix and the next belong to the engine. Write only the 16
 * > of a slot's matrix; anything past them corrupts that instance's material, geometry or
 * > visibility.
 *
 * Always read `stride` and `offset` rather than hard-coding their values. They describe the
 * engine's row layout, which can change between releases.
 * @category scene
 * @advanced
 */
export class BatchMatrices {
  /** Floats from one slot's matrix to the next in {@link BatchMatrices.data | data} */
  public readonly stride: number = MESH3D_STORE_STRIDE;
  /** Float index of slot 0's matrix in {@link BatchMatrices.data | data} */
  public readonly offset: number = 0;

  private readonly _batch: Mesh3DBatch;
  /** Store row of slot 0 */
  private readonly _baseIndex: number = 0;

  /**
   * @param batch - The user batch whose slot matrices this exposes.
   * @param baseIndex - Store row of the batch's slot 0.
   * @internal
   */
  constructor(batch: Mesh3DBatch, baseIndex: number) {
    this._batch = batch;
    this._baseIndex = baseIndex;
    this.offset = baseIndex * MESH3D_STORE_STRIDE;
  }

  /**
   * The batch's per-instance float array
   *
   * Read it each frame rather than holding on to it. The handle stays usable across `unload()`;
   * do not use it after the batch is destroyed.
   */
  public get data(): Float32Array {
    return this._batch.storeBuffer.data;
  }

  /**
   * Picks up matrices written in place through {@link BatchMatrices.data | data}
   *
   * Queues the slots' data for upload and lets culling and shadows see the new positions. Pass the
   * range that changed to invalidate only those slots' bounds. With no arguments it covers every slot.
   * The range must fit within the batch.
   * @param first - The first slot that changed. Must be a non-negative integer.
   * @param count - How many slots changed. Must be a non-negative integer. Defaults to every slot from `first` on.
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

    if (count === items.length) {
      batch._matricesId++;
    } else {
      for (let i = first, end = first + count; i < end; i++) {
        (items[i] as Mesh3DSlot)._boundsCacheId = -1;
      }
    }
  }

  /**
   * Releases the owning batch reference
   * @internal
   */
  public destroy(): void {
    (this._batch as Mesh3DBatch | null) = null;
  }
}
