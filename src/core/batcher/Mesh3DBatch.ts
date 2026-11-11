import type { Geometry3D } from '../../geometry/Geometry3D';
import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import { Matrix4 } from '../../math/matrix/Matrix4';
import type { CullMode } from '../../scene/View3D';
import { InstanceDataStoreBuffer } from '../buffers/InstanceDataStoreBuffer';
import { MESH3D_LANE_MATERIAL, MESH3D_STORE_STRIDE, Mesh3DDataStoreBuffer } from '../buffers/Mesh3DDataStoreBuffer';
import { DrawList } from '../render-passes/DrawList';
import { BatchInstanceData } from './BatchInstanceData';
import { BatchMatrices } from './BatchMatrices';
import type { InstanceDataOptions } from './instanceDataLayout';
import type { Mesh3DData } from './Mesh3DData';
import { Mesh3DSlot } from './Mesh3DSlot';

let _meshBatchUid = 0;
const _identityMatrix = new Matrix4();

interface BatchRenderData {
  worldTransform: Matrix4;
  _worldVisible: number;
  label?: string | null;
}

const SCENE_BATCH_RENDER_DATA: BatchRenderData = {
  worldTransform: _identityMatrix,
  _worldVisible: 1,
};

type Mesh3DBatchSizeOrItems = { size: number; items?: never } | { items: Mesh3DData[]; size?: never };

type Mesh3DBatchOptions = Mesh3DBatchSizeOrItems & {
  renderData?: BatchRenderData;
  instanceData?: InstanceDataOptions;
};

/**
 * A set of meshes drawn together, with its own store and per-pass draw lists: the slots of a
 * {@link BatchedMesh3D}, or a view's scene meshes
 * @internal
 */
export class Mesh3DBatch {
  public readonly uid = ++_meshBatchUid;
  public readonly items: Mesh3DData[];
  public readonly storeBuffer: Mesh3DDataStoreBuffer;
  public readonly drawLists: Record<number, DrawList> = Object.create(null);

  /** Rows share their index with `storeBuffer`'s; `null` without instance data */
  public instanceStoreBuffer: InstanceDataStoreBuffer | null = null;

  /** Row 0, allocated first, since the WebGPU shaders read the batch matrix from `uRenderableStorage[0]` */
  private readonly _batchWorldMatrixIndex: number = 0;

  public readonly renderData: BatchRenderData;

  public readonly isUserBatch: boolean;

  /** Slots waiting for a rebuild, listed once while `_batchDirty` is set; `null` for a scene batch */
  public _dirtyIndices: Uint32Array | null = null;
  public _dirtyCount = 0;

  public _editsPending = false;

  public destroyed = false;

  /** Bumped when an item's visibility or `cull` changes; a draw without culling compacts only when it moves */
  public _visibilityDirtyId = 0;

  private _cull: CullMode = 'off';

  public _lastStoreBufferVersion = 0;

  private readonly _baseIndex: number = 0;
  private _matrices: BatchMatrices | null = null;
  private _instanceData: BatchInstanceData | null = null;

  /** Writes every user slot visible, since the store's visibility starts at 0 and a compaction would drop them all */
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
      for (let i = 0; i < size; i++) {
        items.push(new Mesh3DSlot(i, this._baseIndex + i, this));
        dirtyIndices[i] = i;
      }
      this.storeBuffer.writeVisibilityRange(this._baseIndex, size, 1);
      this.items = items;
      this._dirtyIndices = dirtyIndices;
      this._dirtyCount = size;
      this.isUserBatch = true;

      if (options.instanceData) {
        this.instanceStoreBuffer = new InstanceDataStoreBuffer(options.instanceData, this._baseIndex, size);
      }
    }

    this.writeBatchWorldMatrix(_identityMatrix);
  }

  /** Writes the batch matrix row, copying the 16 floats as 8 f64s; a store row is 12 f64s wide */
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
    this.storeBuffer.markDirty(idx);
  }

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
    this.storeBuffer.markDirty(storeIndex);

    this._writeSlotSphere(index);
  }

  public _writeSlotSphere(index: number): void {
    const store = this.storeBuffer;
    if (!store.writesSpheres) return;
    const geometry = this.items[index].geometry as Geometry3D | undefined;
    if (geometry === undefined) return;
    const storeIndex = this._baseIndex + index;
    store.writeBoundingSphere(storeIndex, store.data, storeIndex * MESH3D_STORE_STRIDE, geometry, 0);
  }

  public get matrices(): BatchMatrices {
    return (this._matrices ??= new BatchMatrices(this, this._baseIndex));
  }

  public get instanceData(): BatchInstanceData {
    if (this._instanceData) return this._instanceData;

    const store = this.instanceStoreBuffer;
    if (!store) {
      throw new Error('instanceData: this batch has no instance data. Declare the fields in the instanceData option.');
    }

    return (this._instanceData = new BatchInstanceData(store, this._baseIndex, this.items.length));
  }

  public setInstanceDataAt(index: number, name: string, x: number, y: number, z: number, w: number): void {
    const store = this.instanceStoreBuffer;
    const offset = store?.layout.offsets[name];
    if (!store || offset === undefined) {
      const declared = store ? `It declares: ${Object.keys(store.layout.offsets).join(', ')}.` : 'It declares none.';

      throw new Error(`setInstanceDataAt: this batch has no instanceData field "${name}". ${declared}`);
    }

    const { layout } = store;
    const storeIndex = this._baseIndex + index;
    const o = storeIndex * layout.stride + offset;
    const target = layout.struct[name] === 'vec4<f32>' ? store.data : store.u32Data;
    target[o] = x;
    target[o + 1] = y;
    target[o + 2] = z;
    target[o + 3] = w;
    store.markDirty(storeIndex);
  }

  public setGeometryAt(index: number, geometry: Geometry3D): void {
    const item = this.items[index] as Mesh3DSlot;
    item.geometry = geometry;
    this._writeSlotSphere(index);
    if (!item._batchDirty) {
      item._batchDirty = true;
      this._dirtyIndices![this._dirtyCount++] = index;
    }
  }

  public setMaterialAt(index: number, material: BaseMaterial3D): void {
    const item = this.items[index] as Mesh3DSlot;
    item.material = material;
    item._lastDescriptorDirtyId = -1;
    if (!item._batchDirty) {
      item._batchDirty = true;
      this._dirtyIndices![this._dirtyCount++] = index;
    }

    if (material._materialIndex !== -1) {
      const storeIndex = this._baseIndex + index;
      this.storeBuffer.u32Data[storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_MATERIAL] = material._materialIndex;
      this.storeBuffer.markDirty(storeIndex);
    }
  }

  public invalidate(index: number): void {
    const item = this.items[index] as Mesh3DSlot;
    if (!item._batchDirty) {
      item._batchDirty = true;
      if (this._dirtyIndices) {
        this._dirtyIndices[this._dirtyCount++] = index;
      }
    }
  }

  public setVisibleAt(index: number, visible: boolean): void {
    const item = this.items[index] as Mesh3DSlot;
    const value = visible ? 1 : 0;
    if (item._worldVisible === value) return;
    item._worldVisible = value;
    this.storeBuffer.writeVisibility(this._baseIndex + index, value);
    this._visibilityDirtyId++;
  }

  public getVisibleAt(index: number): boolean {
    return this.items[index]._worldVisible === 1;
  }

  /**
   * Sets which passes draw a slot
   *
   * A pass's captures go when its last slot leaves, since an empty pass never rebuilds. A joining slot
   * is marked dirty, since the batchers read its pass cache without checking it exists.
   */
  public setPassesAt(index: number, passMask: number): void {
    const item = this.items[index] as Mesh3DSlot;
    const prev = item._lastRenderPass;
    const added = passMask & ~prev;
    const removed = prev & ~passMask;

    let bits = removed;
    while (bits) {
      const bit = bits & -bits;
      const pd = this.drawLists[bit];
      pd.remove(item);
      if (pd.view.count === 0) {
        pd.drawDirtyId++;
        pd.commandList.releaseCaptures();
      }
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
          bit,
        });
      pd.add(item, index);
      bits ^= bit;
    }

    item._lastRenderPass = passMask;
    if (added | removed) this._editsPending = true;

    if (added && !item._batchDirty) {
      item._batchDirty = true;
      if (this._dirtyIndices) this._dirtyIndices[this._dirtyCount++] = index;
    }
  }

  public get cull(): CullMode {
    return this._cull;
  }

  /** Sets the culling mode; a change turns the store's sphere writes off until a CPU cull asks again */
  public set cull(value: CullMode) {
    if (value === this._cull) return;
    this._cull = value;
    this._visibilityDirtyId++;
    if (this.storeBuffer.writesSpheres) this.storeBuffer.enableSphereWrites(false);
  }

  /** Turns sphere writes on and sweeps every row when a CPU cull first asks; a batch never CPU-culled pays nothing */
  public _ensureSpheres(): void {
    const store = this.storeBuffer;
    if (store.writesSpheres) return;
    store.enableSphereWrites(true);
    this._sweepSpheres();
  }

  /** Grows a row's sphere by the morph reach only when its item has a morph, as `Mesh3D.boundingSphere` does */
  private _sweepSpheres(): void {
    if (this.destroyed) return;
    const store = this.storeBuffer;
    const data = store.data;
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Mesh3DData | null;
      if (item === null) continue;
      const row = item._storeIndex;
      const geometry = item.geometry as Geometry3D | undefined;
      if (row < 0 || geometry === undefined) continue;
      store.writeBoundingSphere(
        row,
        data,
        row * MESH3D_STORE_STRIDE,
        geometry,
        item._morph ? geometry._morphBoundsExpansion : 0,
      );
    }
  }

  /**
   * Applies every draw list's membership edits, once, at the end of the scene update, when every
   * joining item has its keys and pass cache to match a command by
   */
  public applyEdits(): void {
    if (!this._editsPending) return;
    this._editsPending = false;
    for (const bit in this.drawLists) this.drawLists[bit].applyEdits();
  }

  public invalidateDrawCaches(): void {
    for (const bit in this.drawLists) this.drawLists[bit].drawDirtyId++;
  }

  public invalidateBundleCaches(): void {
    for (const bit in this.drawLists) this.drawLists[bit].gpuData.bundleDirtyId++;
  }

  public unload(): void {
    if (this.destroyed) return;

    this.storeBuffer.unload();
    this.instanceStoreBuffer?.unload();
    for (const bit in this.drawLists) this.drawLists[bit].unload();
  }

  /** Destroys no geometry, material or scene mesh: the view owns the scene batch's meshes */
  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.storeBuffer.destroy();
    this.instanceStoreBuffer?.destroy();
    this.instanceStoreBuffer = null;

    for (const bit in this.drawLists) this.drawLists[bit].destroy();
    (this.drawLists as Record<number, DrawList> | null) = null;

    if (this.isUserBatch) {
      for (const item of this.items) (item as Mesh3DSlot).destroy();
    }

    this._dirtyIndices = null;
    this._matrices?.destroy();
    this._matrices = null;
    this._instanceData?.destroy();
    this._instanceData = null;
  }
}
