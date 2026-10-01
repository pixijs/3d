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
 * Per-frame scene update for a {@link View3D}
 *
 * Places the scene, builds the view camera, then brings the view's GPU-side scene data up to
 * date: bone matrices, morph data, every mesh batch's store rows and draw lists, and the caches
 * that baked a buffer which has since moved. Each batch and pass keeps its own dirty version, so
 * one dirty batch doesn't invalidate the others.
 *
 * The view camera is built right after the transform walk that places it, because its frame
 * decides whether the rest of the update is worth doing. Bones and morphs settle before the
 * batch walks, because a mesh's store row copies its bone-pit base and morph weight offset.
 * Caller should bail when this returns `false`: the view is fully off-screen.
 * @param view3d - the View being updated this frame
 * @param pipe - backend View3D pipe supplying the stores, the atlas pool and the material system
 * @param session - the frame's render session; its `viewport` is filled here
 * @returns `false` when the view camera is fully off-screen.
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

  return true;
}

/**
 * Refills the view's bone pit with every skinned mesh's bone matrices
 *
 * The pit is refilled from scratch every frame, so a skeleton's base in it moves whenever a
 * skinned mesh joins or leaves. A mesh's store row bakes that base, so the row is re-emitted
 * exactly when the base moves.
 * @param view3d - the View whose skinned meshes are packed
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
      mesh._storeDirty = true;
    }
  }
  view3d._bonePit.update();
}

/**
 * Walks every scene mesh: syncs its pass membership and visibility, rebuilds what a dirty mesh
 * needs, and re-emits changed store rows
 *
 * Membership is which passes a mesh belongs to, never whether it's visible. Both backends skip
 * hidden meshes when they compact the draw data, so hiding or showing a mesh never changes
 * membership and rebuilds no draw commands or render bundles. `removeChild` is the only way out
 * of the lists. A visibility flip re-emits the store row, whose visibility lane is what the GPU
 * reads (the CPU walks read `_worldVisible` itself), and bumps the batch's
 * `_visibilityDirtyId`, which wakes the visibility-only compactions.
 *
 * A texture swap or shader-variant change on the material sends the mesh down the full rebuild
 * path, so the shader recompiles this frame. Each mesh watermarks the material's
 * `_descriptorDirtyId` itself: a flag on the shared material would be consumed by the first mesh
 * the walk reaches, leaving the others with a stale `_passCache` entry, or none at all when the
 * pass bit moved too. Recording the version before `ensureMaterial` is safe because
 * `_batchDirty` is sticky: a mesh in no pass skips the rebuild but still rebuilds on the frame it
 * joins one.
 *
 * A non-dynamic geometry with no atlas allocation was unloaded while a mesh still draws it;
 * `Geometry3D.unload` repacks nothing itself. Its recorded draw arguments bake the vacated range
 * and its store row the old atlas base, so the mesh takes the rebuild path too: repack, re-stage
 * the geometry row, re-key, and rebuild its draw lists. That costs one null check per mesh.
 *
 * The rebuild packs the geometry through the pool, which knows whether it is already packed,
 * before staging its geometry row, because the row bakes the atlas `baseVertex` the packing
 * decides. Each pass then rebuilds what it keeps per mesh in `onRenderableDirty`: batch and sort
 * keys for the forward passes, pass shaders for the shadow pass.
 * @param view3d - the View whose scene batch is walked
 * @param pipe - backend View3D pipe supplying the stores, the atlas pool and the material system
 */
function updateSceneBatch(view3d: View3D, pipe: View3DPipeGpu | View3DPipeGl): void {
  const geomStore = pipe.geometryDataStoreBuffer;
  const allItems = view3d.meshes.items;
  for (let i = 0; i < allItems.length; i++) {
    const renderable = allItems[i];
    const material = renderable.material;

    const membershipMask = renderable.renderPassMask;
    if (membershipMask !== renderable._lastRenderPass) {
      view3d._sceneBatch.setItemActive(view3d._meshSlots.getIndex(renderable), membershipMask);
    }

    if (renderable._worldVisible !== renderable._lastWorldVisible) {
      renderable._lastWorldVisible = renderable._worldVisible;
      renderable._storeDirty = true;
      view3d._sceneBatch._visibilityDirtyId++;
    }

    if (renderable._lastDescriptorDirtyId !== material._descriptorDirtyId) {
      renderable._lastDescriptorDirtyId = material._descriptorDirtyId;
      renderable._batchDirty = true;
    }

    if (renderable._lastRenderPass === 0) continue;

    const geometry = renderable.geometry;
    if (renderable._batchDirty || (geometry._geometryAtlasAllocation === null && !geometry.dynamic)) {
      renderable._batchDirty = false;

      pipe.renderer.material3d.ensureMaterial(renderable, view3d);

      if (!geometry.dynamic) {
        geometry._geometryAtlasAllocation = pipe.atlasPool.allocate(geometry);
      }
      geomStore.set(geometry);

      let bits = renderable.renderPassMask & view3d._dirtyHookBits;
      while (bits) {
        const bit = bits & -bits;
        view3d.passByBit[bit].onRenderableDirty(renderable, view3d._sceneBatch);
        bits ^= bit;
      }
    }

    if (renderable._storeDirty) {
      renderable._storeDirty = false;
      view3d._sceneBatch.storeBuffer.set(renderable);
    }
  }

  view3d._sceneBatch.storeBuffer.update();
}

/**
 * Rebuilds the dirty items of every user batch, such as a `BatchedMesh3D`
 *
 * A batch's world matrix is its owning container's, already current from the transform walk, so
 * it is written every frame. As in the scene batch, each dirty item's geometry is packed before
 * its geometry row is staged, because the row bakes the atlas `baseVertex`; the item's geometry
 * lane then takes the row's index.
 * @param view3d - the View whose user batches are walked
 * @param pipe - backend View3D pipe supplying the stores, the atlas pool and the material system
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
      const material = item.material;

      pipe.renderer.material3d.ensureMaterial(item, view3d);

      if (!item.geometry.dynamic) {
        item.geometry._geometryAtlasAllocation = pipe.atlasPool.allocate(item.geometry);
      }
      geomStore.set(item.geometry);

      batch.storeBuffer.u32Data[item._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_MATERIAL] =
        material._materialIndex;
      batch.storeBuffer.u32Data[item._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_GEOMETRY] =
        item.geometry._geometryDataIndex;
      batch.storeBuffer.markDirtyRange(item._storeIndex, item._storeIndex);

      let bits = item._lastRenderPass & view3d._dirtyHookBits;
      while (bits) {
        const bit = bits & -bits;
        view3d.passByBit[bit].onRenderableDirty(item, batch);
        bits ^= bit;
      }
    }
    batch._dirtyCount = 0;
    batch.storeBuffer.update();
  }
}

/**
 * Re-stages the geometry rows of morphed meshes when the shared atlas has moved
 *
 * A morphed geometry's row caches its atlas `baseVertex`, which the morph bits subtract to turn
 * an atlas-wide vertex id into a geometry-local one. Atlas growth and compaction both move that
 * base without dirtying any mesh, so the rows are re-staged whenever the pool's `bufferVersion`
 * moves. It runs after the batch walks, so an allocation made this frame is already in place.
 * Only morphed geometry caches the base, and the view keeps that list, so a normal frame costs
 * one integer compare.
 * @param view3d - the View whose morphed meshes are re-staged
 * @param pipe - backend View3D pipe supplying the geometry store and the atlas pool
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

/**
 * Invalidates the draw caches that baked a store buffer which grew
 *
 * Recorded command lists and render bundles bake each buffer, so a reallocation (a
 * `bufferVersion` move) leaves them stale. A batch's store belongs to that batch alone, while the
 * bone pit is shared by every batch in the view. Shared buffers outside the view, such as the
 * morph store, the atlas and the material store, are the pipe's to watch, through
 * `detectSharedCacheInvalidation`.
 * @param view3d - the View whose stores are checked
 */
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
