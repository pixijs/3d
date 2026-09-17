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
 * Walks the View's mesh batches, dispatches pass dirty hooks, and updates the
 * bonepit. Each batch/pass owns its structural dirty version, so one dirty
 * batch does not invalidate peers.
 *
 * The pipe is the orchestrator: it provides backend-specific strategy through
 * `materialSystem`, `materialStoreBuffer` and `atlasPool`. The view camera is built here, right
 * after the transform walk that places it — its frame is what decides whether the rest of the
 * update is worth doing. Caller should bail when this returns `false`: the view is fully
 * off-screen.
 * @param view3d - the View being updated this frame
 * @param pipe - backend View3D pipe supplying the strategy hooks
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

  view3d._bonePit.clear();
  const skinnedMeshes = view3d._skinnedMeshes.items;
  for (let i = 0; i < view3d._skinnedMeshes.items.length; i++) {
    const mesh = skinnedMeshes[i];
    const skeleton = mesh.skeleton!;
    skeleton.updateWorld();
    // Rows bake the pit base. The pit is refilled from scratch every frame, so the base
    // moves whenever a skinned mesh joins or leaves; re-emit the row exactly then.
    const base = view3d._bonePit.add(skeleton);
    if (mesh._lastBonePitIndex !== base) {
      mesh._lastBonePitIndex = base;
      mesh._storeDirty = true;
    }
  }
  view3d._bonePit.update();

  // Morph prepare pass — backend-neutral: slots, offsets, rows, and uploads run
  // for both pipes (WebGPU binds the storage buffer, WebGL the store's data
  // texture). Runs before the scene batch loop so the store-row copier reads
  // each morph's up-to-date offsets.
  pipe._morphStoreBuffer.sync(view3d._morphedMeshes.items);

  // Per-geometry data store — every geometry registers (dynamic ones carry a
  // no-cull sentinel radius but keep their morph texel live). Both pipes own
  // one; WebGPU binds the buffer, WebGL its data texture.
  const geomStore = pipe.geometryDataStoreBuffer;

  // --- Scene batch update loop ---
  const allItems = view3d.meshes.items;
  for (let i = 0; i < allItems.length; i++) {
    const renderable = allItems[i];
    const material = renderable.material;

    // Pull-based pass-membership validation. Membership is what KIND of thing this is (its
    // passes) — never whether it's visible: hidden instances are skipped at draw-data level by
    // the compaction walks on both backends, so a hide/show never changes membership and no
    // draw commands or render bundles rebuild. `removeChild` is the way OUT of the lists.
    const membershipMask = renderable.renderPassMask;
    if (membershipMask !== renderable._lastRenderPass) {
      view3d._sceneBatch.setItemActive(view3d._meshSlots.getIndex(renderable), membershipMask);
    }

    // Visibility flip: re-emit the store row (`copyMeshData` mirrors `worldVisible` into the
    // visibility lane — the GPU-side value; the CPU walks read the field directly) and bump the
    // dirty-id that wakes the visibility-only compactions. Never a membership change.
    if (renderable._worldVisible !== renderable._lastWorldVisible) {
      renderable._lastWorldVisible = renderable._worldVisible;
      renderable._storeDirty = true;
      view3d._sceneBatch._visibilityDirtyId++;
    }

    // Texture-swap or shader-variant change — promote to a full batch rebuild
    // so the recompile happens this frame. Watermarked per-mesh (like
    // `_lastRenderPass` above): a shared flag on the material would be consumed
    // by the first mesh the loop reaches, leaving siblings with a stale — or,
    // when `_passBit` moved too, an entirely absent — `_passCache` entry.
    //
    // Recording the version here rather than after `ensureMaterial` is safe:
    // `_batchDirty` is sticky, so a mesh that falls out below (not in an active
    // pass) still rebuilds on the frame it becomes active.
    if (renderable._lastDescriptorDirtyId !== material._descriptorDirtyId) {
      renderable._lastDescriptorDirtyId = material._descriptorDirtyId;
      renderable._batchDirty = true;
    }

    // Skip per-renderable dirty work for meshes not in any active pass
    // (hidden, or empty renderPassMask). Flags persist for the next frame.
    if (renderable._lastRenderPass === 0) continue;

    // A packable geometry with no atlas allocation was unloaded while this mesh still draws it
    // (`Geometry3D.unload` re-packs nothing itself). The recorded draw args bake the vacated
    // range and the store row the old atlas base, so the mesh takes the dirty path: re-pack,
    // re-stage the row, re-key, and rebuild its draw lists. One null check per walked mesh.
    const geometry = renderable.geometry;
    if (renderable._batchDirty || (geometry._geometryAtlasAllocation === null && !geometry.dynamic)) {
      renderable._batchDirty = false;

      pipe.renderer.material3d.ensureMaterial(renderable, view3d);

      // Always through the pool — it owns the "already packed here?" check.
      if (!geometry.dynamic) {
        geometry._geometryAtlasAllocation = pipe.atlasPool.allocate(geometry);
      }
      // Mint _geometryDataIndex + stage the row (sphere + morph texel) after the
      // atlas allocation minted baseVertex, before the store copy (below) reads it.
      geomStore.set(geometry);

      // Dispatch per-pass dirty hooks. Each pass's onRenderableDirty
      // computes its own batch/sort keys (forward passes) or compiles
      // pass-specific shaders (shadow). Polymorphism handles the backend.
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

  // --- User batch update loop ---
  for (let b = 1; b < view3d._meshBatches.length; b++) {
    const batch = view3d._meshBatches[b];

    // User batch worldMatrix is shared with the owning container — always current.
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
      // Mint _geometryDataIndex + stage the row (sphere + morph texel) after the
      // atlas allocation minted baseVertex, before writing [18].
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

  // --- Structural invalidations (pipeline state, not scene state) ---
  // A morphed geometry's store row caches its atlas `baseVertex`, which the morph bits
  // subtract to turn an atlas-wide vertex id into a geometry-local one. Growth and
  // compaction both move that base while dirtying nothing, so re-stamp those rows when
  // the pool's version moves — after the walks above, so an allocation made this frame
  // is already reflected. Only morphed geometry caches the base, and the View keeps that
  // list, so a normal frame costs one integer compare.
  const atlasBufferVersion = pipe.atlasPool.bufferVersion;
  if (view3d._lastAtlasBufferVersion !== atlasBufferVersion) {
    view3d._lastAtlasBufferVersion = atlasBufferVersion;
    const morphedMeshes = view3d._morphedMeshes.items;
    for (let i = 0; i < morphedMeshes.length; i++) geomStore.set(morphedMeshes[i].geometry);
  }

  // Storage growth (a `bufferVersion` move) invalidates cached pass bundles /
  // command lists. Batch-store growth is local; bone storage is shared by every
  // batch in the View.
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
  // Morph store growth is a shared-buffer hazard, handled per view by the pipe
  // through detectSharedCacheInvalidation (same as the atlas / material store).

  return true;
}
