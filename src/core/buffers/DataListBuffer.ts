import { BufferResource, BufferUsage } from 'pixi.js';

import { Buffer3D } from './Buffer3D';

/**
 * Options for `DataListBuffer`
 * @internal
 */
interface RenderDataListOptions {
  /** Floats per list entry */
  stride: number;
  /** Initial capacity in entries; default 100 */
  initialSize?: number;
  /** GPU buffer label for debugging */
  label?: string;
  /** Writes one item's floats into the buffer at `offset`; called per `add` */
  copier: (
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    buffer: Float32Array,
    offset: number,
    stride: number,
  ) => void;
}

/**
 * Sequential append-only list of items that is typically rebuilt each frame
 *
 * Think of it as: `reset()` then many `add(item)` calls -> upload the used prefix to GPU.
 *
 * Use this when:
 * - Your shader consumes an array of the items added this frame (lights, shadows, particles, instances).
 * - Items are naturally sequential for the current frame (ordering can change each frame).
 * - You do NOT need persistent uid->slot mapping.
 *
 * Upload strategy:
 * - `update()` uploads only the used prefix: `itemCount * stride * 4` bytes from offset 0.
 * - This is usually ideal because lists like lights/shadows are constructed sequentially anyway.
 *
 * Performance notes:
 * - The `copier` is called per `add` and should be unrolled/optimized for its stride.
 * - For short lists, full-prefix upload is cheap and avoids complex dirty tracking.
 * @internal
 */
export class DataListBuffer {
  private _data: Float32Array;
  private readonly _buffer: Buffer3D;
  /** Bindable resource for shaders */
  public readonly bufferResource: BufferResource;
  private readonly _stride: number;
  private _count: number = 0;
  private readonly _copier: (
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    buffer: Float32Array,
    offset: number,
    stride: number,
  ) => void;

  constructor(options: RenderDataListOptions) {
    this._stride = options.stride;
    this._data = new Float32Array((options.initialSize || 100) * this._stride);
    this._copier = options.copier;

    this._buffer = new Buffer3D({
      data: this._data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: options.label || 'RenderDataList',
    });

    this.bufferResource = new BufferResource({ buffer: this._buffer });
  }

  /** Backing CPU array */
  get data(): Float32Array {
    return this._data;
  }

  /** Clears the list for the next frame (does not clear memory) */
  public reset(): void {
    this._count = 0;
  }

  /**
   * Appends one item to the list (writes into the CPU buffer immediately)
   *
   * Call `update()` after you finish adding all items.
   * @param item - The item to append; passed straight to the `copier`.
   */
  public add(item: unknown): void {
    if (this._count * this._stride >= this._data.length) {
      this._expand();
    }

    const offset = this._count * this._stride;
    this._copier(item, this._data, offset, this._stride);
    this._count++;
  }

  /** Uploads the used prefix to the GPU; the list is assumed rebuilt every frame, so no dirty tracking is needed */
  public update(): void {
    if (this._count === 0) return;

    const sizeInBytes = this._count * this._stride * 4;
    this._buffer.update(sizeInBytes, 0);
  }

  private _expand(): void {
    const newSize = this._data.length * 2;
    const newData = new Float32Array(newSize);
    newData.set(this._data);
    this._data = newData;

    this._buffer.data = this.data;
  }

  /**
   * Frees the GPU copy of the list while keeping the CPU array
   *
   * pixi re-creates the buffer from `data` the next time it is fetched, so
   * nothing has to be re-marked dirty for the revival. Idempotent.
   */
  public unload(): void {
    this._buffer?.unload();
  }

  /**
   * Releases the exclusively-owned GPU buffer and drops the backing array
   *
   * `_expand` resizes the existing `Buffer` in place (no orphans), so the
   * single buffer here is all that needs freeing. Idempotent — a second call is
   * a no-op.
   */
  public destroy(): void {
    if (!this._buffer) return;

    // Free the BufferResource first (destroyBuffer:false) so its bound bind
    // groups react to its change before the Buffer it references is destroyed.
    this.bufferResource.destroy(false);
    this._buffer.destroy();

    (this._buffer as Buffer3D | null) = null;
    (this.bufferResource as BufferResource | null) = null;
    (this._data as Float32Array | null) = null;
  }
}
