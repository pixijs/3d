import { BufferResource, BufferUsage } from 'pixi.js';

import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { Buffer3D } from './Buffer3D';

/**
 * Per-(batch, pass) buffer holding one interleaved `RenderableInstance` record
 * per draw-order slot: `[storeIndex, packedTextureSlots]` (2× u32)
 *
 * Consumed by the shader as `array<RenderableInstance>`, indexed by
 * `instance_index`.
 *
 * The id halves (`data[i*2]`) are written by `populateIds`; the texture-slot
 * halves (`data[i*2 + 1]`) are written by the batcher. Fusing the two into one
 * buffer keeps them from desyncing under GPU compaction and frees a
 * storage-buffer binding.
 * @internal
 */
export class RenderInstanceBuffer {
  /** Bindable resource for shaders */
  public readonly bufferResource: BufferResource;

  private readonly _buffer: Buffer3D;
  /** Interleaved u32 pairs: `[id0, tex0, id1, tex1, ...]` */
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

  /** The underlying pixi `Buffer` — bound raw (not via `bufferResource`) by the compaction compute */
  public get buffer(): Buffer3D {
    return this._buffer;
  }

  /**
   * Ensures the buffer can hold at least `count` instances (2 u32 each), growing by 1.5x if needed
   *
   * Contents are not preserved — every slot is rewritten (ids via
   * `populateIds`, texture slots via the batcher) before the next `upload`.
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
   * Writes the id half of each slot (`data[i*2] = _storeIndex`) from the sorted pass view
   *
   * Does NOT upload — the batcher writes the texture-slot halves next, then a
   * single `upload` pushes both.
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
   * Uploads `count` instances (both halves) to the GPU
   * @param count - Number of instances to upload.
   */
  public upload(count: number): void {
    this._buffer.update(count * 2 * 4); // 2 u32 * 4 bytes each
  }

  /**
   * Frees the GPU copy of the instance records while keeping the CPU array
   *
   * pixi re-creates the buffer from `data` on the next fetch; the next rebuild
   * rewrites every slot anyway. Idempotent.
   */
  public unload(): void {
    this._buffer?.unload();
  }

  /**
   * Releases the exclusively-owned GPU buffer and drops the backing array
   *
   * `ensureSize` resizes the existing `Buffer` in place (no orphans), so the
   * single buffer here is all that needs freeing. Idempotent — a second call
   * is a no-op.
   */
  public destroy(): void {
    if (!this._buffer) return;

    // Free the BufferResource first (destroyBuffer:false) so its bound bind
    // groups react to its change before the Buffer it references is destroyed.
    this.bufferResource.destroy(false);
    this._buffer.destroy();

    (this._buffer as Buffer3D | null) = null;
    (this.bufferResource as BufferResource | null) = null;
    (this.data as Uint32Array | null) = null;
  }
}
