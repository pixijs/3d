import { BufferResource, BufferUsage } from 'pixi.js';

import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { Buffer3D } from './Buffer3D';

/**
 * One `RenderableInstance` record per instance in draw order, `[storeIndex, packedTextureSlots]`,
 * for one batch and pass (WebGPU)
 *
 * `populateIds` writes the store indices, `data[i * 2]`, and the batcher the packed texture slots,
 * `data[i * 2 + 1]`. Keeping both in one buffer means the compaction can't separate them, and it
 * takes one storage-buffer binding instead of two.
 * @internal
 */
export class RenderInstanceBuffer {
  /** Bindable resource for shaders */
  public readonly bufferResource: BufferResource;

  private readonly _buffer: Buffer3D;
  /** The records as `u32` pairs, `[id0, tex0, id1, tex1, ...]` */
  public data: Uint32Array;

  constructor(label: string, initialInstances = 128) {
    this.data = new Uint32Array(initialInstances * 2);

    this._buffer = new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label,
      shrinkToFit: false,
    });

    this.bufferResource = new BufferResource({ buffer: this._buffer });
  }

  /** The underlying buffer, which the cull compute binds directly rather than through `bufferResource` */
  public get buffer(): Buffer3D {
    return this._buffer;
  }

  /**
   * Makes room for at least `count` instances, growing to 1.5 times that when it must
   *
   * Growth doesn't keep the contents: `populateIds` and the batcher rewrite every record before
   * the next `upload`.
   * @param count - Number of instances to make room for.
   * @returns The current backing array.
   */
  public ensureSize(count: number): Uint32Array {
    if (this.data.length < count * 2) {
      this.data = new Uint32Array(Math.ceil(count * 2 * 1.5));
      this._buffer.data = this.data;
    }
    return this.data;
  }

  /**
   * Writes each instance's store index, in the view's sorted order
   *
   * Doesn't upload: the batcher writes the texture slots next, and one `upload` sends both.
   * @param view - The sorted pass view to source store indices from.
   */
  public populateIds(view: SortedMesh3DView<Mesh3DData>): void {
    const count = view.count;
    const data = this.ensureSize(count);
    const sortedIndices = view.indices;
    const items = view.items;

    for (let i = 0; i < count; i++) {
      data[i * 2] = items[sortedIndices[i]]!._storeIndex;
    }
  }

  /**
   * Uploads the first `count` records
   * @param count - Number of instances to upload.
   */
  public upload(count: number): void {
    this._buffer.update(count * 2 * 4);
  }

  /**
   * Frees the GPU copy of the records and keeps the CPU array
   *
   * pixi re-creates the buffer from `data` the next time it's bound, and the next rebuild rewrites
   * every record anyway. Idempotent.
   */
  public unload(): void {
    this._buffer?.unload();
  }

  /**
   * Releases the GPU buffer and drops the CPU array
   *
   * `ensureSize` resizes the one buffer in place, so there's nothing else to free. Idempotent.
   */
  public destroy(): void {
    if (!this._buffer) return;

    this.bufferResource.destroy(false);
    this._buffer.destroy();

    (this._buffer as Buffer3D | null) = null;
    (this.bufferResource as BufferResource | null) = null;
    (this.data as Uint32Array | null) = null;
  }
}
