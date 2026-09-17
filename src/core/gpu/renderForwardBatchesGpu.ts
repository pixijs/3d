import { GlobalResourceRegistry } from 'pixi.js';
import type { RenderBundle } from 'pixi.js';

import type { Vector3 } from '../../math/vector/Vector3';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { getCameraData } from '../CameraData';
import { resolveCullProducer, transformFrustumToBatch } from '../cull';
import type { CullResults } from '../render-passes/CullResult';
import type { RenderSession } from '../render-passes/RenderSession';
import { produceCpuCompaction } from './cull';
import type { View3DPipeGpu } from './View3DPipeGpu';

/**
 * Per-batch sort hook — receives the sorted view, its owning batch, and the drawing eye
 * @internal
 */
type SortBatchFnGpu = (renderables: SortedMesh3DView<Mesh3DData>, batch: Mesh3DBatch, cameraPosition: Vector3) => void;

/**
 * Options shared by the prepare/compute/render phases of the WebGPU forward passes
 * @internal
 */
interface RenderForwardBatchesGpuOptions {
  /** The WebGPU backend pipe driving this render */
  pipe: View3DPipeGpu;
  /** This pass's bit — indexes `batch.drawLists` */
  bit: number;
  /** This pass's per-batch cull results: where its survivors, counts and bundles live */
  cullResults: CullResults;
  /**
   * Camera to cull and draw from, or `null` for the view's own camera
   *
   * Supplies the frustum, the bind group bound at group 1, and the eye the distance sort
   * measures from. Culling reads {@link Camera3D#cullFrustum}.
   */
  camera: Camera3D | null;
  /** The frame's render session */
  session: RenderSession;
  /**
   * Cache draw commands as a GPU render bundle (opaque/transmission/outline)
   * vs. replay the command list immediately every frame (transparent).
   */
  useBundles: boolean;
  /**
   * Always rebuild the bundle/command list, ignoring the dirty-version and
   * count-change checks. Used by transparent (re-sorts every frame).
   */
  alwaysRebuild: boolean;
  /** Optional per-batch sort; defaults to key-based `renderables.sort()` */
  sortBatch?: SortBatchFnGpu;
  /**
   * When true, the batcher skips texture-atlas packing and the batch
   * texture bind group. Suitable for depth-only or solid-colour passes.
   */
  skipTextureBatching?: boolean;
}

/**
 * Prepare phase for the bundled forward passes (opaque / transmission / blended-refraction)
 *
 * Sorts, populates the instance buffer, builds the draw-command list, and uploads the
 * instance buffer — all **before** any render target is bound.
 *
 * Split out of `renderForwardBatchesGpu` so a cull compute can run between the
 * uploads here and the bundle replay there (compute can't run inside a render
 * pass). Runs in the graph's execute pre-sweep. Immediate-replay passes
 * (`useBundles === false`) have no bundle to hoist into and prepare inline in
 * `renderForwardBatchesGpu`, so this returns immediately for them.
 *
 * The draw claim (`claimDrawBuilt`) is deliberately left for
 * `renderForwardBatchesGpu`, so compute can observe that this frame's
 * draw data was rebuilt. Bundle-only invalidation may still happen between
 * prepare and render when the graph binds a new sampled texture source.
 * @param options - The pass's pipe, bit, session, and draw-cache policy
 * @internal
 */
export function prepareForwardBatchesGpu(options: RenderForwardBatchesGpuOptions): void {
  const { pipe, bit, session, useBundles, alwaysRebuild, sortBatch, skipTextureBatching = false } = options;

  // Immediate-replay passes prepare inline in renderForwardBatchesGpu (no bundle).
  if (!useBundles) return;

  const { view3d } = session;
  const batcher = pipe.renderer.material3d.batcher;
  const cameraPosition = getCameraData(options.camera ?? view3d.camera).position;

  for (const batch of view3d._meshBatches) {
    if (!batch.renderData._worldVisible) continue;
    const list = batch.drawLists[bit];
    if (!list) continue;
    const renderables = list.view;
    if (renderables.count === 0) continue;

    const needsRebuild = alwaysRebuild || list.isDrawStale(renderables.count);
    if (!needsRebuild) continue;

    if (sortBatch) sortBatch(renderables, batch, cameraPosition);
    else renderables.sort();

    const gpuData = list.gpuData;
    gpuData.instanceBuffer.populateIds(renderables);

    batcher.render({
      renderables,
      globalBindGroup: session.globalBindGroup,
      instanceData: gpuData.instanceBuffer.data,
      commandList: list.commandList,
      drawData: list.drawData,
      passBit: bit,
      skipTextureBatching,
    });

    // The list's own args stay CPU-side on WebGPU: they are the template each cull result copies
    // its lanes from (`CullResult.sync`), and only a result's copy is ever drawn from. The rebuild
    // moved the command list's dirty id, which is what makes every result re-sync and re-record.
    gpuData.instanceBuffer.upload(renderables.count);

    // Resolve the cull producer for this batch — rebuild-gated (it only changes
    // with instance count, which itself forces a rebuild, and with `view3d.cull`,
    // whose setter forces one). The compute route reads it to pick who fills the
    // survivors.
    list._cullProducer = resolveCullProducer(view3d.cull, true, renderables.count);
  }
}

/**
 * Compute phase for bundled forward passes: dispatch the compaction compute over each batch's
 * instance + draw-call buffers — between the prepare uploads and the render's `drawIndexedIndirect`
 *
 * The compute compacts survivors from the list's `instanceBuffer` into this pass's
 * `CullResult` for the batch and rebuilds each command's `instanceCount` there; the render then
 * binds the result's survivors at the instance slot. Recorded here in the graph's execute
 * pre-sweep (no render pass open) and submitted in `ComputeSystemGpu.renderEnd`, ahead of the
 * render submit. Immediate-replay passes aren't compacted, so this returns for them.
 * @param options - The pass's pipe, bit, session, cull results, and draw-cache policy
 * @internal
 */
export function computeForwardBatchesGpu(options: RenderForwardBatchesGpuOptions): void {
  const { pipe, bit, cullResults, session, useBundles } = options;
  if (!useBundles) return;

  const { view3d } = session;
  // Shared across the view's batches: the per-geometry bounds store (GPU buffer, read by the compute
  // kernel) and the world-space planes of the drawing camera's cull frustum — rebuilt in the update
  // phase (view camera) or this pass's `prepare` (its own camera), before this.
  // (The CPU producer sources bounds from each instance's cached sphere, not this store.)
  const boundsBuffer = pipe.geometryDataStoreBuffer.buffer;
  const planes = (options.camera ?? view3d.camera).cullFrustum.planesData;

  // Results for batches the view detached go back to the pool (gated on the batch list's dirty id).
  cullResults.removeDetached(view3d);

  for (const batch of view3d._meshBatches) {
    if (!batch.renderData._worldVisible) continue;
    const list = batch.drawLists[bit];
    if (!list || list.view.count === 0) continue;

    // This pass's result for the batch, re-synced to the list if prepare rebuilt it (fresh lane
    // copy, survivors sized, bundle dropped).
    const result = cullResults.ensure(batch);
    result.sync(list);

    // Route on the producer resolved in prepareForwardBatchesGpu — it selects who FILLS the
    // survivors (bundles always bind them). 'off' → visibility-only walk; 'cpu' → JS
    // frustum cull; 'gpu' → the compute kernel.
    const producer = list._cullProducer;
    if (producer === 'off') {
      // This walk is CPU work, so only run it when its answer could have changed:
      // something was hidden or shown (the dirty-id moved), or the sync above reset the
      // watermark because this pass rebuilt its draw data. Otherwise last frame's survivors
      // are still right. The frustum producers below can't skip like this — the camera is one
      // of their inputs and it has no change signal.
      if (result.lastVisibilityDirtyId !== batch._visibilityDirtyId) {
        produceCpuCompaction(list, batch, null, result);
      }
      continue;
    }
    if (producer === 'cpu') {
      produceCpuCompaction(list, batch, planes, result);
      continue;
    }

    // Same batch-frame trick as the CPU cull: transform the frustum into the batch's local space
    // once, so the kernel tests `L × geom` directly — no per-instance `B × L` combine.
    const batchPlanes = transformFrustumToBatch(planes, batch.storeBuffer.data);
    pipe.renderer.compute3d.dispatch(
      result.indirectDrawData.drawCallsBuffer,
      list.gpuData.instanceBuffer.buffer,
      result.survivors.buffer,
      batch.storeBuffer.buffer,
      boundsBuffer,
      batchPlanes,
      list.commandList.count,
      list.view.count,
    );
  }
}

/**
 * Render phase for forward-style WebGPU passes
 *
 * For bundled passes the draw data was already built by `prepareForwardBatchesGpu` in the graph
 * pre-sweep (a bundled pass MUST call it from `prepare()`) and this pass's survivors filled in
 * the compute phase; here we bind slots 11/12 and (re)record the result's bundle — now that
 * the graph has bound this pass's sampled textures, so the bundle captures the right bind-group
 * state — then execute it. Immediate-replay passes (transparent) have no prepare phase and
 * build, sync and compact inline.
 *
 * Slot bindings: 11 = store, 12 = instances [id + texSlots] — always this pass's survivors for
 * the batch: bundled passes were filled by a producer in the pre-sweep, immediate passes run
 * the same compaction inline right after their per-frame build. Draw-data rebuilds are prepared
 * from the batch/pass dirty versions. Bundle recording is separately gated by the list's
 * `bundleDirtyId` (a sampled texture swap re-records without rebuilding the unchanged command
 * list), by the camera group `isBundleStale` is handed (a different `CameraData` than the
 * bundle baked), and by `encoder.isBundleValid` (the bundle's baked target stamp — attachment
 * state + winding — no longer matches the bound target). Valid bundles are collected and replayed in a
 * single `executeBundle` call after the batch walk. Passes with a different shape (shadow,
 * background, copy-opaque) implement `render()` themselves and don't call this.
 *
 * Invariant: `useBundles === false` requires `alwaysRebuild === true` — an
 * immediate replay that skipped rebuild would replay against the previous
 * batch's slot-11/12 bindings. Bundles capture their bindings at record time.
 * @param options - The pass's pipe, bit, session, cull results, and draw-cache policy
 * @internal
 */
export function renderForwardBatchesGpu(options: RenderForwardBatchesGpuOptions): void {
  const {
    pipe,
    bit,
    cullResults,
    session,
    useBundles,
    alwaysRebuild,
    sortBatch,
    skipTextureBatching = false,
  } = options;

  if (!useBundles && !alwaysRebuild) {
    throw new Error(
      'renderForwardBatchesGpu: useBundles=false requires alwaysRebuild=true (immediate replay needs per-batch bindings re-bound every frame).',
    );
  }

  const { view3d } = session;
  const encoder = pipe.renderer.encoder;
  const batcher = pipe.renderer.material3d.batcher;
  const gcNow = pipe.renderer.gc.now;
  const camera = options.camera ?? view3d.camera;
  const cameraData = getCameraData(camera);
  // Immediate-pass compaction inputs (bundled passes compacted in the pre-sweep).
  const planes = camera.cullFrustum.planesData;
  const boundsBuffer = pipe.geometryDataStoreBuffer.buffer;

  // Immediate passes have no compute phase, so their detached results are removed here.
  if (!useBundles) cullResults.removeDetached(view3d);

  let bundleIndex = 0;

  for (const batch of view3d._meshBatches) {
    if (!batch.renderData._worldVisible) continue;
    const list = batch.drawLists[bit];
    if (!list) continue;
    const renderables = list.view;

    if (renderables.count === 0) {
      list.claimDrawEmpty();
      if (useBundles) {
        const result = cullResults.get(batch);
        if (result) {
          result.bundle = null;
          result.claimBundleRecorded(list, cameraData.bindGroup);
        }
      }
      continue;
    }

    const drawRebuilt = alwaysRebuild || list.isDrawStale(renderables.count);
    const result = cullResults.ensure(batch);

    if (useBundles) {
      const recorded = result.bundle;

      if (!recorded || result.isBundleStale(list, cameraData.bindGroup) || !encoder.isBundleValid(recorded)) {
        // Sort / instance buffer / command list + cull producer ran in the pre-sweep, and the
        // compute phase synced and filled this result. Bundles always bind the result's survivors
        // — every producer fills them ('off' via the visibility-only walk) — so a producer change
        // never invalidates a recorded bundle.
        session.globalBindGroup.setResource(batch.storeBuffer.bufferResource, 11);
        session.globalBindGroup.setResource(result.survivors.bufferResource, 12);
        encoder.beginBundle(`view3d pass ${bit} batch ${batch.uid}`);
        list.commandList.replay(encoder, pipe.renderer.buffer, result.indirectDrawData, cameraData);
        result.bundle = encoder.endBundle();
        result.claimBundleRecorded(list, cameraData.bindGroup);
      }
    } else if (drawRebuilt) {
      // Immediate replay: no prepare phase, build inline.
      if (sortBatch) sortBatch(renderables, batch, cameraData.position);
      else renderables.sort();
      const gpuData = list.gpuData;
      gpuData.instanceBuffer.populateIds(renderables);

      batcher.render({
        renderables,
        globalBindGroup: session.globalBindGroup,
        instanceData: gpuData.instanceBuffer.data,
        commandList: list.commandList,
        drawData: list.drawData,
        passBit: bit,
        skipTextureBatching,
      });

      gpuData.instanceBuffer.upload(renderables.count);

      // The rebuild moved the command list, so the result re-copies its lanes and re-sizes its
      // survivors before anything binds them — growth swaps the underlying GPUBuffer (the
      // BufferResource identity is stable and re-keys bind groups).
      result.sync(list);

      session.globalBindGroup.setResource(batch.storeBuffer.bufferResource, 11);
      session.globalBindGroup.setResource(result.survivors.bufferResource, 12);

      // Same compaction as the bundled passes, run right after the per-frame build —
      // visibility always, frustum above the auto gate. The replay binds the survivors
      // (slot 12 above), so hidden/culled instances just shrink the counts.
      const producer = resolveCullProducer(view3d.cull, true, renderables.count);
      list._cullProducer = producer;
      if (producer === 'gpu') {
        // Recorded now, submitted in ComputeSystemGpu.renderEnd — queue-ordered before the
        // render submit, so the replayed indirect draws read the compacted counts.
        const batchPlanes = transformFrustumToBatch(planes, batch.storeBuffer.data);
        pipe.renderer.compute3d.dispatch(
          result.indirectDrawData.drawCallsBuffer,
          gpuData.instanceBuffer.buffer,
          result.survivors.buffer,
          batch.storeBuffer.buffer,
          boundsBuffer,
          batchPlanes,
          list.commandList.count,
          list.view.count,
        );
      } else {
        produceCpuCompaction(list, batch, producer === 'cpu' ? planes : null, result);
      }
    }

    list.claimDrawBuilt(renderables.count);

    if (useBundles) {
      // A bundle replay binds nothing, so pixi's per-bind GC stamps never reach the resources it
      // bakes; stamp them here or the GC would collect a texture drawn every frame.
      list.commandList.touch(gcNow);
      bundleRun[bundleIndex++] = result.bundle!;
    } else {
      list.commandList.replay(encoder, pipe.renderer.buffer, result.indirectDrawData, cameraData);
    }
  }

  // Replay the whole run in one call — pass state resets after every executeBundles,
  // so per-batch calls would pay one cache clear each for the same result.
  if (bundleIndex > 0) {
    encoder.executeBundle(bundleRun);
    // A retained bundle pins every GPU resource it recorded — release the refs now.
    bundleRun.length = 0;
  }
}

/**
 * Scratch for the pass's valid bundles, replayed in a single `executeBundle` call
 *
 * Module-scoped and emptied right after each replay, so it is always empty between
 * calls — the cursor writes in the batch walk rebuild its length exactly, and it
 * holds no bundle refs between frames. Passes render sequentially so it is never
 * live for two passes at once.
 */
const bundleRun: RenderBundle[] = [];
GlobalResourceRegistry.register({
  clear: () => {
    bundleRun.length = 0;
  },
});
