import type { Geometry3D } from '../../geometry/Geometry3D';
import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import { Matrix4 } from '../../math/matrix/Matrix4';
import {
  MESH3D_LANE_MATERIAL,
  MESH3D_LANE_VISIBILITY,
  MESH3D_STORE_STRIDE,
  Mesh3DDataStoreBuffer,
} from '../buffers/Mesh3DDataStoreBuffer';
import { DrawList } from '../render-passes/DrawList';
import type { Mesh3DData } from './Mesh3DData';
import { Mesh3DSlot } from './Mesh3DSlot';

let _meshBatchUid = 0;
const _identityMatrix = new Matrix4();

/**
 * Per-frame render-side data the batch needs from its owner
 *
 * Structurally satisfied by `Container3D` (and therefore {@link BatchedMesh3D}),
 * so a `BatchedMesh3D` just hands itself in via the `renderData` option.
 * The scene batch omits the option and uses a static stub
 * (`SCENE_BATCH_RENDER_DATA`) — identity matrix, always visible.
 * Per-mesh visibility for scene-graph meshes rides the store row's
 * visibility lane on WebGPU (skipped at draw-data level) and folds into
 * `setItemActive` membership on WebGL — see `updateView3DScene`.
 * @internal
 */
interface BatchRenderData {
  /** The owner's world matrix, written to the batch matrix slot each frame */
  worldTransform: Matrix4;
  /** 0|1 visibility mask — see `Container3D.worldVisible` */
  _worldVisible: number;
}

const SCENE_BATCH_RENDER_DATA: BatchRenderData = {
  worldTransform: _identityMatrix,
  _worldVisible: 1,
};

type Mesh3DBatchSizeOrItems = { size: number; items?: never } | { items: Mesh3DData[]; size?: never };

/**
 * Options for constructing a `Mesh3DBatch` — exactly one of `size` (user batch) or `items` (scene batch)
 * @internal
 */
type Mesh3DBatchOptions = Mesh3DBatchSizeOrItems & {
  /**
   * Render-side data sourced from the batch's owner. Defaults to a
   * static scene-batch stub (identity matrix, always visible). User
   * batches ({@link BatchedMesh3D}) pass `renderData: this` so render passes
   * read `worldTransform` / `_worldVisible` from the owner.
   */
  renderData?: BatchRenderData;
};

/**
 * A self-contained mesh collection
 *
 * Two construction modes:
 * - `{ size }` — user batch: pre-allocates `size` Mesh3DSlots. Use
 *   setMatrixAt/setGeometryAt/setMaterialAt/setItemActive to populate.
 * - `{ items }` — scene batch: wraps an existing items array (e.g. the
 *   mesh items managed by View3D). Used internally.
 *
 * Each batch owns its store buffer, ID buffers, and draw lists so multiple
 * batches can coexist in one View3D without conflicting bind group state.
 * @internal
 */
export class Mesh3DBatch {
  /** Stable unique batch id */
  public readonly uid = ++_meshBatchUid;
  /** The batch's mesh items — `Mesh3DSlot`s for a user batch, an externally-managed array for a scene batch */
  public readonly items: Mesh3DData[];
  /** Per-instance data store (matrices, material indices, visibility lanes) owned by this batch */
  public readonly storeBuffer: Mesh3DDataStoreBuffer;
  /** Per-pass draw lists keyed by `RenderPassBit`, created lazily by `setItemActive` */
  public readonly drawLists: Record<number, DrawList> = Object.create(null);

  /** Store buffer index of slot 0 (batch world matrix) */
  private readonly _batchWorldMatrixIndex: number;

  /**
   * Render-side data sourced from the batch's owner (a {@link BatchedMesh3D})
   *
   * Defaults to a static "scene batch" stub: identity matrix, always visible.
   * Set once via the constructor `options.renderData` — `BatchedMesh3D`
   * passes `renderData: this` so render passes can read `worldTransform` and
   * `_worldVisible` from the owner without a typed back-reference to
   * `Container3D`.
   */
  public readonly renderData: BatchRenderData;

  /**
   * True for a user batch (`{ size }`), whose slots keep local matrices in the store buffer
   *
   * False for a scene batch, whose items carry their own `worldTransform`.
   */
  public readonly isUserBatch: boolean;

  /**
   * Dirty index list for user batches
   *
   * Tracks which items have been modified (via `setGeometryAt` / `setMaterialAt`)
   * since the last `View3DPipe` update. This avoids iterating all N items
   * every frame — only the dirty subset is processed.
   *
   * The `_batchDirty` flag on each `Mesh3DSlot` guards against duplicate
   * insertion: an item is only appended to `_dirtyIndices` the first time
   * it's dirtied between frames. `View3DPipe` resets `_dirtyCount` to 0
   * after processing.
   *
   * Scene batches (`{ items }` constructor) leave this null — they iterate
   * all items every frame since scene graph meshes can change at any time.
   * @internal
   */
  public _dirtyIndices: Uint32Array | null = null;
  /** Number of valid entries in `_dirtyIndices`; reset to 0 after processing */
  public _dirtyCount = 0;

  /** True once `destroy()` has run; guards against double-free */
  public destroyed = false;

  /**
   * Bumped whenever a store row's visibility lane changes (see `updateView3DScene`)
   *
   * Batches with no frustum producer dirty-gate their visibility-only
   * compaction on it, so the walk (and its uploads) only run on frames where
   * something actually flipped.
   * @internal
   */
  public _visibilityDirtyId = 0;

  /**
   * Last-seen `storeBuffer` `bufferVersion`
   *
   * `updateView3DScene` compares it each frame and invalidates this batch's
   * draw caches when the store reallocated on growth — cached command lists /
   * bundles bind the old buffer.
   * @internal
   */
  public _lastStoreBufferVersion = 0;

  private readonly _baseIndex: number;

  constructor(options: Mesh3DBatchOptions) {
    this.renderData = options.renderData ?? SCENE_BATCH_RENDER_DATA;
    this.storeBuffer = new Mesh3DDataStoreBuffer();

    // Slot 0 is always reserved for the batch world matrix.
    const matrixSlotOwner = { _storeIndex: -1 };
    this._batchWorldMatrixIndex = this.storeBuffer.allocateBlock(matrixSlotOwner, 1);

    if (options.items !== undefined) {
      // Scene batch: items array is managed externally (by View3D / StableList).
      this.items = options.items;
      this._baseIndex = 0;
      this.isUserBatch = false;
    } else {
      // User batch: pre-allocate contiguous store buffer slots upfront.
      // Items start at slot 1 (after the batch matrix slot).
      const size = options.size;
      const blockOwner = { _storeIndex: -1 };
      this._baseIndex = this.storeBuffer.allocateBlock(blockOwner, size);
      const items: Mesh3DSlot[] = [];
      const dirtyIndices = new Uint32Array(size);
      const u32 = this.storeBuffer.u32Data;
      for (let i = 0; i < size; i++) {
        items.push(new Mesh3DSlot(i, this._baseIndex + i, this.storeBuffer));
        dirtyIndices[i] = i;
        // Default every instance to visible. Nothing ever rewrites this lane for user-batch slots
        // (slot show/hide is a membership change via `setItemActive`, and the freshly-allocated
        // block is zero-filled), so without the default the cull compaction would drop every slot.
        // `allocateBlock` already marked the block dirty, so these writes ride the same upload.
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
   * Write a world matrix to slot 0 of the store buffer (the batch matrix)
   *
   * For scene batches this stays identity. For user batches (BatchedMesh3D),
   * the container's worldTransform is written here each frame.
   * @param matrix - The owner's world matrix.
   */
  public writeBatchWorldMatrix(matrix: Matrix4): void {
    const idx = this._batchWorldMatrixIndex;
    const fl64 = this.storeBuffer.fl64Data;
    const wm64 = matrix.elements64;
    const o = idx * 12; // stride 24 f32 / 2 = 12 f64 per entry
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
   * Write a local matrix directly to the store buffer
   *
   * O(1), zero GC. Does NOT require a draw command rebuild: both backends read the
   * transform straight out of the store buffer this writes.
   *
   * The matrix must be **affine** — rotation, scale, shear and translation, with a
   * `(0, 0, 0, 1)` bottom row. Projective transforms are not supported and their bottom
   * row is not preserved.
   *
   * This is the one transform path that does not enforce that for you. Everything else
   * goes through {@link Matrix4.multiplyAffine}, which reads only the twelve informative
   * lanes and writes the bottom row as constants, so a scene-graph transform cannot be
   * anything else. Node matrices loaded from glTF are decomposed to TRS on the way in for
   * the same reason. This method copies what it is given, so it is the only place a
   * projective matrix could reach the store, and the store does not promise to keep it.
   * @param index - The slot index within this batch.
   * @param matrix - The slot's new local matrix. Must be affine.
   */
  public setMatrixAt(index: number, matrix: Matrix4): void {
    const storeIndex = this._baseIndex + index;
    const fl64 = this.storeBuffer.fl64Data;
    const wm64 = matrix.elements64;
    const o = storeIndex * 12; // stride 24 f32 / 2 = 12 f64 per entry
    fl64[o] = wm64[0];
    fl64[o + 1] = wm64[1];
    fl64[o + 2] = wm64[2];
    fl64[o + 3] = wm64[3];
    fl64[o + 4] = wm64[4];
    fl64[o + 5] = wm64[5];
    fl64[o + 6] = wm64[6];
    fl64[o + 7] = wm64[7];
    this.storeBuffer.markDirtyRange(storeIndex, storeIndex);

    // matrix changed → cached bounding sphere is stale
    (this.items[index] as Mesh3DSlot)._boundsCacheDirty = true;
  }

  /**
   * Swap the geometry for a slot
   *
   * Triggers a draw command rebuild next frame: marks the slot dirty so the `View3DPipe` loop recreates the shader for the
   * new geometry's vertex layout. Appends to `_dirtyIndices` if not already
   * dirty.
   * @param index - The slot index within this batch.
   * @param geometry - The slot's new geometry.
   */
  public setGeometryAt(index: number, geometry: Geometry3D): void {
    const item = this.items[index] as Mesh3DSlot;
    item.geometry = geometry;
    item._boundsCacheDirty = true; // new geometry → new local sphere
    if (!item._batchDirty) {
      item._batchDirty = true;
      this._dirtyIndices![this._dirtyCount++] = index;
    }
  }

  /**
   * Swap the material for a slot
   *
   * Triggers a draw command rebuild next frame. If the material has already been registered in the material store buffer
   * (`_materialIndex !== -1`), writes its index into the store buffer
   * immediately so the GPU picks it up without waiting for the dirty loop.
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
   * Force a rebuild of a slot's pipeline state and batch assignment
   *
   * Geometry attributes and material bits are expected to be stable after the
   * first render. If you dynamically modify the geometry layout (e.g. adding
   * tangent attributes) or change a material's custom bits for an item in this
   * batch, call this to flush the cached state.
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
   * Add or remove a slot from render pass views
   *
   * `DrawList` entries are created lazily on first activation.
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
      // The last renderable leaving a pass is the one event that empties it: drop the build's captures
      // here so a pass that never rebuilds retains none of them.
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
   * Gives back this batch's GPU memory without losing the CPU state that rebuilds
   * it: the store buffer's GPU copy (and WebGL data texture) plus every pass's recorded
   * draw program, bundles, and instance/indirect buffers. Idempotent; the next frame
   * re-uploads and rebuilds.
   * @internal
   */
  public unload(): void {
    if (this.destroyed) return;

    this.storeBuffer.unload();
    for (const bit in this.drawLists) this.drawLists[bit].unload();
  }

  /**
   * Release this batch's exclusively-owned GPU resources: the store buffer and every per-pass `DrawList`
   *
   * `items` are intentionally left untouched — for the scene batch they are
   * owned by `View3D._meshSlots`, and for a user batch they belong to the
   * owning `BatchedMesh3D`. The meshes themselves are shared resources and are
   * never destroyed here.
   */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.storeBuffer.destroy();

    for (const bit in this.drawLists) {
      this.drawLists[bit].destroy();
      delete this.drawLists[bit];
    }

    this._dirtyIndices = null;
  }
}
