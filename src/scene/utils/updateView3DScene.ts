import { clearList } from 'pixi.js';

import {
  MESH3D_LANE_GEOMETRY,
  MESH3D_LANE_MATERIAL,
  MESH3D_STORE_STRIDE,
} from '../../core/buffers/Mesh3DDataStoreBuffer';
import { getCameraData } from '../../core/CameraData';
import type { View3DPipeGl } from '../../core/gl/View3DPipeGl';
import type { View3DPipeGpu } from '../../core/gpu/View3DPipeGpu';
import { prepareCamera } from '../../core/prepareCamera';
import type { RenderSession } from '../../core/render-passes/RenderSession';
import { validateCamera } from '../../core/validateCamera';
import type { View3D } from '../View3D';
import { updateView3DTransforms } from './updateView3DTransforms';

/**
 * Per-frame scene update. Bones and morphs settle before the batch walks, since store rows copy their offsets, and
 * `Mesh3DBatch.applyEdits` runs last, once every joining item has its keys
 * @returns `false` when the view camera is fully off-screen, and the caller draws nothing
 * @internal
 */
export function updateView3DScene(view3d: View3D, pipe: View3DPipeGpu | View3DPipeGl, session: RenderSession): boolean {
  updateView3DTransforms(view3d);
  validateCamera(view3d);

  prepareCamera(view3d.camera, session);
  const frame = getCameraData(view3d.camera).frame;
  if (frame.width <= 0 || frame.height <= 0) return false;

  view3d._syncShadowSampling();

  refillBonePit(view3d);
  pipe._morphStoreBuffer.sync(view3d._morphedMeshes.items);

  updateSceneBatch(view3d, pipe);
  updateUserBatches(view3d, pipe);

  restampMorphedGeometry(view3d, pipe);
  invalidateGrownStores(view3d);

  const batches = view3d._meshBatches;
  for (let b = 0; b < batches.length; b++) batches[b].applyEdits();

  return true;
}

/**
 * The pit refills every frame, so a skeleton's base moves when a skinned mesh joins or leaves, and the store row that
 * bakes the base is re-emitted when it moves
 */
function refillBonePit(view3d: View3D): void {
  view3d._bonePit.clear();
  const skinnedMeshes = view3d._skinnedMeshes.items;
  for (let i = 0; i < view3d._skinnedMeshes.items.length; i++) {
    const mesh = skinnedMeshes[i];
    const skeleton = mesh.skeleton!;
    skeleton.updateWorld();
    const base = view3d._bonePit.add(skeleton);
    if (mesh._lastBonePitIndex !== base) {
      mesh._lastBonePitIndex = base;
      mesh._markStoreDirty();
    }
  }
  view3d._bonePit.update();
}

/**
 * Drains the mesh update queue, keeping meshes queued during the drain for next frame. A geometry is packed before its
 * row is staged, since the row bakes the atlas `baseVertex`
 */
function updateSceneBatch(view3d: View3D, pipe: View3DPipeGpu | View3DPipeGl): void {
  const geomStore = pipe.geometryDataStoreBuffer;
  const queue = view3d._renderablesToUpdate;
  const queued = queue.list;
  const queuedCount = queue.index;
  for (let i = 0; i < queuedCount; i++) {
    const renderable = queued[i];
    renderable.didRenderableUpdate = false;
    if (renderable._view3d !== view3d) continue;

    const material = renderable.material;

    const membershipMask = renderable.renderPassMask;
    if (membershipMask !== renderable._lastRenderPass) {
      view3d._sceneBatch.setPassesAt(view3d._meshSlots.getIndex(renderable), membershipMask);
    }

    let rebuildsLists = false;
    if (renderable._lastDescriptorDirtyId !== material._descriptorDirtyId) {
      rebuildsLists = renderable._lastDescriptorDirtyId !== -1;
      renderable._lastDescriptorDirtyId = material._descriptorDirtyId;
      renderable._batchDirty = true;
    }

    if (renderable._lastRenderPass === 0) continue;

    const geometry = renderable.geometry;
    const unpacked = geometry._geometryAtlasAllocation === null && !geometry.dynamic;
    if (renderable._batchDirty || unpacked) {
      renderable._batchDirty = false;
      rebuildsLists ||= unpacked && geometry._atlasVacated;

      pipe.renderer.material3d.ensureMaterial(renderable, view3d._sceneBatch, view3d);

      if (!geometry.dynamic) {
        geometry._geometryAtlasAllocation = pipe.atlasPool.allocate(geometry);
      }
      geomStore.set(geometry);

      let bits = renderable.renderPassMask & view3d._dirtyHookBits;
      while (bits) {
        const bit = bits & -bits;
        view3d.passByBit[bit].onRenderableDirty(renderable, view3d._sceneBatch, rebuildsLists);
        bits ^= bit;
      }
    }

    if (renderable._storeDirty) {
      renderable._storeDirty = false;
      view3d._sceneBatch.storeBuffer.set(renderable);
    }
  }

  const requeued = queue.index - queuedCount;
  for (let i = 0; i < requeued; i++) queued[i] = queued[queuedCount + i];
  clearList(queued, requeued);
  queue.index = requeued;

  view3d._sceneBatch.storeBuffer.update();
}

/**
 * Skips a slot in no pass, which `Mesh3DBatch.setPassesAt` re-queues when it joins one; packs each geometry before
 * staging its row, as `updateSceneBatch` does
 */
function updateUserBatches(view3d: View3D, pipe: View3DPipeGpu | View3DPipeGl): void {
  const geomStore = pipe.geometryDataStoreBuffer;
  for (let b = 1; b < view3d._meshBatches.length; b++) {
    const batch = view3d._meshBatches[b];

    batch.writeBatchWorldMatrix(batch.renderData.worldTransform);

    const dirtyIndices = batch._dirtyIndices!;
    const dirtyCount = batch._dirtyCount;

    for (let d = 0; d < dirtyCount; d++) {
      const item = batch.items[dirtyIndices[d]];
      item._batchDirty = false;
      const passes = item._lastRenderPass;
      if (passes === 0) continue;

      const material = item.material;
      let rebuildsLists =
        item.geometry._geometryAtlasAllocation === null && !item.geometry.dynamic && item.geometry._atlasVacated;
      if (item._lastDescriptorDirtyId !== material._descriptorDirtyId) {
        rebuildsLists ||= item._lastDescriptorDirtyId !== -1;
        item._lastDescriptorDirtyId = material._descriptorDirtyId;
      }

      pipe.renderer.material3d.ensureMaterial(item, batch, view3d);

      if (!item.geometry.dynamic) {
        item.geometry._geometryAtlasAllocation = pipe.atlasPool.allocate(item.geometry);
      }
      geomStore.set(item.geometry);

      batch.storeBuffer.u32Data[item._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_MATERIAL] =
        material._materialIndex;
      batch.storeBuffer.u32Data[item._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_GEOMETRY] =
        item.geometry._geometryDataIndex;
      batch.storeBuffer.markDirty(item._storeIndex);

      let bits = passes & view3d._dirtyHookBits;
      while (bits) {
        const bit = bits & -bits;
        view3d.passByBit[bit].onRenderableDirty(item, batch, rebuildsLists);
        bits ^= bit;
      }
    }
    batch._dirtyCount = 0;
    batch.storeBuffer.update();
    batch.instanceStoreBuffer?.update();
  }
}

/**
 * Morphed geometry rows bake the atlas `baseVertex`, which growth and compaction move without dirtying a mesh; runs
 * after the batch walks, so this frame's allocations are in place
 */
function restampMorphedGeometry(view3d: View3D, pipe: View3DPipeGpu | View3DPipeGl): void {
  const geomStore = pipe.geometryDataStoreBuffer;
  const atlasBufferVersion = pipe.atlasPool.bufferVersion;
  if (view3d._lastAtlasBufferVersion !== atlasBufferVersion) {
    view3d._lastAtlasBufferVersion = atlasBufferVersion;
    const morphedMeshes = view3d._morphedMeshes.items;
    for (let i = 0; i < morphedMeshes.length; i++) geomStore.set(morphedMeshes[i].geometry);
  }
}

/** Covers the view's own stores; `detectSharedCacheInvalidation` covers the shared atlas, material and morph stores */
function invalidateGrownStores(view3d: View3D): void {
  for (let b = 0; b < view3d._meshBatches.length; b++) {
    const batch = view3d._meshBatches[b];
    const storeVersion = batch.storeBuffer.bufferVersion;
    if (batch._lastStoreBufferVersion !== storeVersion) {
      batch._lastStoreBufferVersion = storeVersion;
      batch.invalidateDrawCaches();
    }
  }
  const boneVersion = view3d._bonePit.bufferVersion;
  if (view3d._lastBonePitBufferVersion !== boneVersion) {
    view3d._lastBonePitBufferVersion = boneVersion;
    view3d._invalidateDrawCaches();
  }
}
