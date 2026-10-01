import type { BaseMaterial3D, MaterialUploadQueue } from '../../materials/BaseMaterial3D';
import { DataStoreBuffer } from './DataStoreBuffer';

/**
 * Floats per material row, 64 floats or 256 bytes
 *
 * A {@link Material3D} with every extension on packs to 46 floats, so the rest is headroom for new
 * fields. `mergeMaterialStruct` throws when a material's packed struct doesn't fit.
 * @internal
 */
export const MATERIAL_STRIDE_FLOATS = 64;

/**
 * Bytes per material slot
 * @internal
 */
export const MATERIAL_STRIDE_BYTES = MATERIAL_STRIDE_FLOATS * 4;

/**
 * The material store, one row per material, with the queue of rows waiting to be copied in
 *
 * `material.update()` queues the material through `enqueueDirty`. The pipe's per-frame `update`
 * copies the queued rows in and then uploads, so a queued change can't miss the upload. Each
 * renderer's View3D pipe has one, and its material system registers materials through it.
 *
 * Materials belong to the user and outlive the store, which dies with its renderer, so the store
 * keeps no list of them. Each material carries the store that gave it its row, `_uploadQueue`.
 * When another store sees it, `register` hands the old row back and gives it a new one, and calls
 * to a destroyed store do nothing. Only one renderer may draw a material at a time: two live
 * renderers would swap its row every frame.
 * @internal
 */
export class MaterialDataStoreBuffer extends DataStoreBuffer implements MaterialUploadQueue {
  /**
   * Materials whose packed data changed since the last `update`, the first `_dirtyCount` entries
   *
   * A material's `_storeQueued` flag keeps it from being queued twice. The drain nulls each entry,
   * so a busy frame can't keep materials from being garbage collected.
   */
  private readonly _dirtyQueue: (BaseMaterial3D | null)[] = [];
  private _dirtyCount = 0;

  /**
   * Copying a row is one bit-exact copy. `material.data` already is the packed Material struct, a
   * row long and laid out by the same merge the shader compiles, and its `u32` fields come along
   * through the float view, since a copy between arrays of the same type moves bytes unchanged.
   */
  constructor() {
    super({
      stride: MATERIAL_STRIDE_FLOATS,
      initialSize: 100,
      indexKey: '_materialIndex',
      copier: (
        material: BaseMaterial3D,
        buffer: Float32Array,
        _u32Buffer: Uint32Array,
        _fl64Buffer: Float64Array,
        offset: number,
      ) => {
        buffer.set(material.data._f32, offset);
      },
    });
  }

  /**
   * Queues a material's row to be copied in and uploaded on the next `update`
   *
   * A material already queued isn't queued again, however many writes it takes. Does nothing once
   * the store is destroyed, so a late `material.update()` can't leave the material flagged as
   * queued on a store that will never drain.
   * @param material - The material whose row to re-upload.
   */
  public enqueueDirty(material: BaseMaterial3D): void {
    if (!this.data || material._storeQueued) return;
    material._storeQueued = true;
    this._dirtyQueue[this._dirtyCount++] = material;
  }

  /**
   * Gives a material a row in this store; `ensureMaterial` calls it whenever a mesh gets a material
   *
   * The row index is assigned straight away, since callers write it into mesh rows in the same
   * walk, but the data goes through the queue like every other change. Does nothing for a material
   * that already has a row here. A row from another store is handed back there and a new one given
   * here, as `GeometryDataStoreBuffer.set` explains.
   * @param material - The material to register.
   */
  public register(material: BaseMaterial3D): void {
    const old = material._uploadQueue;
    if (old === this && material._materialIndex !== -1) return;

    if (old && old !== this) old.remove(material);
    material._uploadQueue = this;
    material._storeQueued = false;
    this.allocate(material);
    this.enqueueDirty(material);
  }

  /**
   * Copies the queued materials' rows in, then uploads the changed span
   *
   * The count resets before the drain, so a throw partway can't leave it counting entries already
   * nulled. A queued material that was destroyed, or has a row in another store by now, no longer
   * names this store as its `_uploadQueue`, and is skipped.
   */
  public override update(): void {
    const queue = this._dirtyQueue;
    const count = this._dirtyCount;
    this._dirtyCount = 0;
    for (let i = 0; i < count; i++) {
      const material = queue[i]!;
      queue[i] = null;
      if (material._uploadQueue !== this) continue;
      material._storeQueued = false;
      this.set(material);
    }
    super.update();
  }

  /**
   * Drops the queue along with the rows when the renderer goes; each material gets a row in the
   * next store that sees it
   */
  public override destroy(): void {
    this._dirtyQueue.length = 0;
    this._dirtyCount = 0;
    super.destroy();
  }
}
