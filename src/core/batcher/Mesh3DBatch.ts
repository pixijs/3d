import type { Geometry3D } from '../../geometry/Geometry3D';
import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import { Matrix4 } from '../../math/matrix/Matrix4';
import type { CullMode } from '../../scene/View3D';
import {
  MESH3D_LANE_MATERIAL,
  MESH3D_LANE_VISIBILITY,
  MESH3D_STORE_STRIDE,
  Mesh3DDataStoreBuffer,
} from '../buffers/Mesh3DDataStoreBuffer';
import { DrawList } from '../render-passes/DrawList';
import { BatchMatrices } from './BatchMatrices';
import type { Mesh3DData } from './Mesh3DData';
import { Mesh3DSlot } from './Mesh3DSlot';

let _meshBatchUid = 0;
const _identityMatrix = new Matrix4();

/**
 * What the render passes read from a batch's owner each frame
 *
 * `Container3D` has both fields, so a {@link BatchedMesh3D} passes itself as `renderData`. The scene
 * batch has no owner and uses `SCENE_BATCH_RENDER_DATA`. This is the whole batch's transform and
 * visibility; a scene mesh's own visibility is in its store row, and both backends skip hidden
 * meshes when they compact the draw data.
 * @internal
 */
interface BatchRenderData {
  /** The owner's world matrix, written to the batch matrix row each frame */
  worldTransform: Matrix4;
  /** The owner's `Container3D.worldVisible` as 0 or 1 */
  _worldVisible: number;
}

/** The scene batch's stand-in owner: an identity matrix, always visible */
const SCENE_BATCH_RENDER_DATA: BatchRenderData = {
  worldTransform: _identityMatrix,
  _worldVisible: 1,
};

type Mesh3DBatchSizeOrItems = { size: number; items?: never } | { items: Mesh3DData[]; size?: never };

/**
 * Options for a `Mesh3DBatch`: `size` for a user batch or `items` for a scene batch, never both
 * @internal
 */
type Mesh3DBatchOptions = Mesh3DBatchSizeOrItems & {
  /** The owner the render passes read the batch's transform and visibility from; see {@link Mesh3DBatch#renderData} */
  renderData?: BatchRenderData;
};

/**
 * A set of meshes drawn together, with its own store buffer and per-pass draw lists
 *
 * Two kinds:
 * - `{ size }` builds a user batch, the engine side of a {@link BatchedMesh3D}: `size` slots,
 *   filled through `setMatrixAt`, `setGeometryAt`, `setMaterialAt` and `setItemActive`.
 * - `{ items }` builds a View3D's scene batch around the View's own mesh list.
 *
 * Owning its store and draw lists lets several batches share a View3D without sharing bind groups.
 * @internal
 */
export class Mesh3DBatch {
  /** Stable unique batch id */
  public readonly uid = ++_meshBatchUid;
  /** The batch's items: its own `Mesh3DSlot`s for a user batch, the View's mesh list for a scene batch */
  public readonly items: Mesh3DData[];
  /** Per-instance data store (matrices, material indices, visibility lanes) owned by this batch */
  public readonly storeBuffer: Mesh3DDataStoreBuffer;
  /** Per-pass draw lists keyed by `RenderPassBit`, created lazily by `setItemActive` */
  public readonly drawLists: Record<number, DrawList> = Object.create(null);

  /** Store row of the batch world matrix, always the first row the batch allocates */
  private readonly _batchWorldMatrixIndex: number = 0;

  /**
   * The owner the render passes read the batch's transform and visibility from
   *
   * A {@link BatchedMesh3D} passes itself; the scene batch gets an identity matrix that is always
   * visible. Typed by the two fields it needs rather than as `Container3D`.
   */
  public readonly renderData: BatchRenderData;

  /**
   * True for a user batch (`{ size }`), whose slots keep local matrices in the store buffer
   *
   * False for a scene batch, whose items carry their own `worldTransform`.
   */
  public readonly isUserBatch: boolean;

  /**
   * Slots changed through `setGeometryAt`, `setMaterialAt` or `invalidate` since the last frame, so
   * the per-frame update walks only those
   *
   * A slot's `_batchDirty` flag keeps it from being listed twice. `updateView3DScene` processes the
   * list and resets `_dirtyCount`. Null for a scene batch, whose update walks every mesh each frame.
   * @internal
   */
  public _dirtyIndices: Uint32Array | null = null;
  /** Number of valid entries in `_dirtyIndices` */
  public _dirtyCount = 0;

  /** True once `destroy()` has run */
  public destroyed = false;

  /**
   * Bumped by `updateView3DScene` whenever a mesh's visibility flips
   *
   * A draw without frustum culling compacts only for visibility, and only on frames where this has
   * moved.
   * @internal
   */
  public _visibilityDirtyId = 0;

  /** Backing field for {@link cull} */
  private _cull: CullMode = 'auto';

  /**
   * The `storeBuffer.bufferVersion` this batch's draw caches were built against
   *
   * `updateView3DScene` invalidates the caches when the store grows, since recorded command lists
   * and bundles bind the old buffer.
   * @internal
   */
  public _lastStoreBufferVersion = 0;

  /**
   * Bumped by a whole-batch matrix write through {@link Mesh3DBatch.matrices}
   *
   * Each `Mesh3DSlot` caches its bounding sphere against this id, so one increment marks every
   * slot's sphere stale without touching the slots.
   * @internal
   */
  public _matricesId = 0;

  /** Store row of slot 0; the scene batch's meshes hold their own rows */
  private readonly _baseIndex: number = 0;
  private _matrices: BatchMatrices | null = null;

  /**
   * A user batch starts every slot visible. The store's visibility lane is zero-filled, and nothing
   * else writes it for a slot, since hiding one is a membership change through `setItemActive`;
   * left at zero, the cull compaction would drop every slot. `allocateBlock` has already marked the
   * block for upload.
   * @param options - `{ size }` for a user batch, `{ items }` for a scene batch
   */
  constructor(options: Mesh3DBatchOptions) {
    this.renderData = options.renderData ?? SCENE_BATCH_RENDER_DATA;
    this.storeBuffer = new Mesh3DDataStoreBuffer();

    const matrixSlotOwner = { _storeIndex: -1 };
    this._batchWorldMatrixIndex = this.storeBuffer.allocateBlock(matrixSlotOwner, 1);

    if (options.items !== undefined) {
      this.items = options.items;
      this._baseIndex = 0;
      this.isUserBatch = false;
    } else {
      const size = options.size;
      const blockOwner = { _storeIndex: -1 };
      this._baseIndex = this.storeBuffer.allocateBlock(blockOwner, size);
      const items: Mesh3DSlot[] = [];
      const dirtyIndices = new Uint32Array(size);
      const u32 = this.storeBuffer.u32Data;
      for (let i = 0; i < size; i++) {
        items.push(new Mesh3DSlot(i, this._baseIndex + i, this));
        dirtyIndices[i] = i;
        u32[(this._baseIndex + i) * MESH3D_STORE_STRIDE + MESH3D_LANE_VISIBILITY] = 1;
      }
      this.items = items;
      this._dirtyIndices = dirtyIndices;
      this._dirtyCount = size;
      this.isUserBatch = true;
    }

    this.writeBatchWorldMatrix(_identityMatrix);
  }

  /**
   * Writes the batch world matrix row
   *
   * It stays identity for the scene batch. A user batch gets its container's `worldTransform`
   * every frame. The 16 floats move as 8 f64 copies, and a row is 12 f64 wide, half of
   * `MESH3D_STORE_STRIDE`.
   * @param matrix - The owner's world matrix.
   */
  public writeBatchWorldMatrix(matrix: Matrix4): void {
    const idx = this._batchWorldMatrixIndex;
    const fl64 = this.storeBuffer.fl64Data;
    const wm64 = matrix.elements64;
    const o = idx * 12;
    fl64[o] = wm64[0];
    fl64[o + 1] = wm64[1];
    fl64[o + 2] = wm64[2];
    fl64[o + 3] = wm64[3];
    fl64[o + 4] = wm64[4];
    fl64[o + 5] = wm64[5];
    fl64[o + 6] = wm64[6];
    fl64[o + 7] = wm64[7];
    this.storeBuffer.markDirtyRange(idx, idx);
  }

  /**
   * Copies a slot's local matrix into the store buffer
   *
   * Allocates nothing and needs no draw-command rebuild: both backends read the transform from the
   * store on every draw. The copy works as in {@link Mesh3DBatch#writeBatchWorldMatrix}.
   *
   * The matrix must be affine, with a bottom row of `(0, 0, 0, 1)`. The store keeps all 16 floats
   * and the vertex shader applies them, but the slot's bounds and the cull read only the top three
   * rows, so a projective matrix culls against the wrong sphere. Scene-graph transforms can't be
   * projective: they come from {@link Matrix4.multiplyAffine}, and glTF node matrices are decomposed
   * on load. This method and {@link BatchMatrices.data} copy whatever they're given.
   * @param index - The slot index within this batch.
   * @param matrix - The slot's new local matrix. Must be affine.
   */
  public setMatrixAt(index: number, matrix: Matrix4): void {
    const storeIndex = this._baseIndex + index;
    const fl64 = this.storeBuffer.fl64Data;
    const wm64 = matrix.elements64;
    const o = storeIndex * 12;
    fl64[o] = wm64[0];
    fl64[o + 1] = wm64[1];
    fl64[o + 2] = wm64[2];
    fl64[o + 3] = wm64[3];
    fl64[o + 4] = wm64[4];
    fl64[o + 5] = wm64[5];
    fl64[o + 6] = wm64[6];
    fl64[o + 7] = wm64[7];
    this.storeBuffer.markDirtyRange(storeIndex, storeIndex);

    (this.items[index] as Mesh3DSlot)._boundsCacheId = -1;
  }

  /**
   * The slot matrices as interleaved data for bulk writes
   *
   * User batches only. Created on first read. See {@link BatchMatrices}.
   */
  public get matrices(): BatchMatrices {
    return (this._matrices ??= new BatchMatrices(this, this._baseIndex));
  }

  /**
   * Swaps the geometry for a slot
   *
   * Marks the slot dirty, so the next frame rebuilds its draw commands and recompiles its shader for
   * the new geometry's vertex layout.
   * @param index - The slot index within this batch.
   * @param geometry - The slot's new geometry.
   */
  public setGeometryAt(index: number, geometry: Geometry3D): void {
    const item = this.items[index] as Mesh3DSlot;
    item.geometry = geometry;
    item._boundsCacheId = -1;
    if (!item._batchDirty) {
      item._batchDirty = true;
      this._dirtyIndices![this._dirtyCount++] = index;
    }
  }

  /**
   * Swaps the material for a slot
   *
   * Marks the slot dirty, so the next frame rebuilds its draw commands. A material that already has
   * a row in the material store gets its index written into the slot's row straight away.
   * @param index - The slot index within this batch.
   * @param material - The slot's new material.
   */
  public setMaterialAt(index: number, material: BaseMaterial3D): void {
    const item = this.items[index] as Mesh3DSlot;
    item.material = material;
    if (!item._batchDirty) {
      item._batchDirty = true;
      this._dirtyIndices![this._dirtyCount++] = index;
    }

    if (material._materialIndex !== -1) {
      const storeIndex = this._baseIndex + index;
      this.storeBuffer.u32Data[storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_MATERIAL] = material._materialIndex;
      this.storeBuffer.markDirtyRange(storeIndex, storeIndex);
    }
  }

  /**
   * Forces a rebuild of a slot's shader, state and batch keys on the next frame
   *
   * Slots don't watch their geometry's layout or their material's shader settings after the first
   * render. Call this after changing either.
   * @param index - The slot index within this batch.
   */
  public invalidate(index: number): void {
    const item = this.items[index] as Mesh3DSlot;
    if (!item._batchDirty) {
      item._batchDirty = true;
      if (this._dirtyIndices) {
        this._dirtyIndices[this._dirtyCount++] = index;
      }
    }
  }

  /**
   * Sets which passes draw a slot
   *
   * A pass's `DrawList` is created the first time a slot joins it. When the last slot leaves a pass,
   * its command list releases its captures, so a pass that never rebuilds holds none of them.
   * @param index - The slot index within this batch.
   * @param passMask - New bitmask of RenderPassBit flags for this slot.
   */
  public setItemActive(index: number, passMask: number): void {
    const item = this.items[index] as Mesh3DSlot;
    const prev = item._lastRenderPass;
    const added = passMask & ~prev;
    const removed = prev & ~passMask;

    let bits = removed;
    while (bits) {
      const bit = bits & -bits;
      const pd = this.drawLists[bit];
      pd.view.remove(item.uid);
      pd.drawDirtyId++;
      if (pd.view.count === 0) pd.commandList.releaseCaptures();
      bits ^= bit;
    }

    bits = added;
    while (bits) {
      const bit = bits & -bits;
      let pd = this.drawLists[bit];
      if (!pd)
        pd = this.drawLists[bit] = new DrawList({
          items: this.items,
          label: `pass_${bit}`,
        });
      pd.view.add(item.uid, index, item._sortKey);
      pd.drawDirtyId++;
      bits ^= bit;
    }

    item._lastRenderPass = passMask;
  }

  /**
   * This batch's frustum-culling mode
   *
   * Every pass that draws the batch resolves its cull producer from this alone: the scene batch
   * takes its view's `cull` (View3D writes it), a {@link BatchedMesh3D}'s batch its own. Changing it
   * invalidates the batch's draw lists, because some passes resolve the producer only when they
   * rebuild.
   */
  public get cull(): CullMode {
    return this._cull;
  }

  /**
   * Sets this batch's frustum-culling mode, invalidating its draw lists when it changes
   * @param value - The culling mode.
   */
  public set cull(value: CullMode) {
    if (value === this._cull) return;
    this._cull = value;
    this.invalidateDrawCaches();
  }

  /**
   * Invalidate every cached draw program owned by this batch
   * @internal
   */
  public invalidateDrawCaches(): void {
    for (const bit in this.drawLists) this.drawLists[bit].drawDirtyId++;
  }

  /**
   * Invalidate every cached WebGPU bundle owned by this batch without rebuilding draw data
   * @internal
   */
  public invalidateBundleCaches(): void {
    for (const bit in this.drawLists) this.drawLists[bit].gpuData.bundleDirtyId++;
  }

  /**
   * Gives back this batch's GPU memory and keeps the CPU state that rebuilds it
   *
   * Covers the store's GPU copies and every pass's recorded draw commands, bundles and instance
   * and indirect buffers. The next frame re-uploads and rebuilds. Idempotent.
   * @internal
   */
  public unload(): void {
    if (this.destroyed) return;

    this.storeBuffer.unload();
    for (const bit in this.drawLists) this.drawLists[bit].unload();
  }

  /**
   * Releases the store buffer and every pass's `DrawList`
   *
   * A user batch's slots drop their reference to the batch. The scene batch's meshes belong to the
   * View, and no geometry or material is destroyed here.
   */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.storeBuffer.destroy();

    for (const bit in this.drawLists) {
      this.drawLists[bit].destroy();
      delete this.drawLists[bit];
    }

    if (this.isUserBatch) {
      for (const item of this.items) (item as Mesh3DSlot).destroy();
    }

    this._dirtyIndices = null;
    this._matrices?.destroy();
    this._matrices = null;
  }
}
