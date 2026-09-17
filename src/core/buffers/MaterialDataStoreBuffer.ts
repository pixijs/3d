import type { BaseMaterial3D, MaterialUploadQueue } from '../../materials/BaseMaterial3D';
import { DataStoreBuffer } from './DataStoreBuffer';

/**
 * Floats per material slot: 64 floats / 256 B
 *
 * The worst-case Material3D struct (every glTF extension on simultaneously:
 * clearcoat + sheen + specular + iridescence + transmission + emissive +
 * uvTransform + normalScale) lays out to ~52 floats with WGSL alignment; 64
 * leaves headroom for future extensions without forcing field-tetris on every
 * new contributor.
 * @internal
 */
export const MATERIAL_STRIDE_FLOATS = 64;

/**
 * Bytes per material slot
 * @internal
 */
export const MATERIAL_STRIDE_BYTES = MATERIAL_STRIDE_FLOATS * 4;

/**
 * The material store — rows, slots, upload — plus the dirty queue in front of them
 *
 * Materials signal `enqueueDirty` (via `material.update()`); the pipe's
 * per-frame `update` stages queued rows and then uploads the dirty range, so
 * drain-before-upload ordering is unskippable. One per pipe; the backend
 * material systems register materials through it.
 *
 * Materials are user-owned and outlive the store (which dies with its
 * renderer), so the store keeps no membership list: each material carries the
 * store that minted its row (`_uploadQueue`); when that is not this store,
 * `register` hands the old row back to it and re-mints here, and calls through
 * a back-reference to a destroyed store are no-ops. One live renderer at a
 * time — two live renderers drawing the same material would re-mint it every
 * frame.
 * @internal
 */
export class MaterialDataStoreBuffer extends DataStoreBuffer implements MaterialUploadQueue {
  /**
   * Materials whose packed data changed since the last `update`
   *
   * `material.update()` lands here (coalesced on `_storeQueued`) — the
   * transform-system shape: mutation raises a flag, the per-frame pass syncs
   * it to the GPU. Count-indexed (the `_dirtyIndices` idiom); the drain
   * nulls slots so a burst frame can't pin materials against GC.
   */
  private readonly _dirtyQueue: (BaseMaterial3D | null)[] = [];
  private _dirtyCount = 0;

  constructor() {
    super({
      stride: MATERIAL_STRIDE_FLOATS,
      initialSize: 100,
      indexKey: '_materialIndex',
      // `material.data` IS the packed Material struct (stride-sized, laid out
      // by the same merge the shader compiles), so upload staging is a single
      // bit-exact copy — u32 fields ride along through the f32 view, which is
      // a memmove for same-typed arrays.
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
   * Queues a material's row for re-upload on the next `update`
   *
   * Repeat calls while queued are no-ops — one entry, one copy, however many
   * writes. Inert once the store is destroyed, so a late `material.update()`
   * can't latch the queued flag against a store that will never drain.
   * @param material - The material whose row to re-upload.
   */
  public enqueueDirty(material: BaseMaterial3D): void {
    if (!this.buffer || material._storeQueued) return;
    material._storeQueued = true;
    this._dirtyQueue[this._dirtyCount++] = material;
  }

  /**
   * Wires a material to this store, called by `ensureMaterial` (which always
   * runs when a material is newly assigned)
   *
   * Mints the slot index synchronously — callers write it into renderable
   * rows in the same walk — but the data itself rides the queue like every
   * other upload: one copy path. No-op once resident here. A row minted by
   * another store (a destroyed renderer's, typically) is never adopted, since
   * the foreign index may name a row this store gave someone else: it is handed
   * back to that store (whose `remove` resets the index) and a fresh row minted
   * here.
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

  /** Per-frame material sync: drains the dirty queue into staged rows, then uploads the dirty range */
  public override update(): void {
    const queue = this._dirtyQueue;
    const count = this._dirtyCount;
    // Reset before draining — a throw mid-drain must not leave the count
    // pointing at already-nulled slots on the next frame.
    this._dirtyCount = 0;
    for (let i = 0; i < count; i++) {
      const material = queue[i]!;
      queue[i] = null;
      // Only a material still wired here has a row to stage. One destroyed
      // while queued (destroy nulls the queue and lowers the flag) or re-minted
      // by another store (the flag is that store's now) falls out of this check.
      if (material._uploadQueue !== this) continue;
      material._storeQueued = false;
      this.set(material);
    }
    super.update();
  }

  /** Renderer teardown: drops the pending queue along with the rows; the materials re-mint elsewhere on sight */
  public override destroy(): void {
    this._dirtyQueue.length = 0;
    this._dirtyCount = 0;
    super.destroy();
  }
}
