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
   * Record the draws into a render bundle and replay it, as the key-sorted passes do; `false`
   * replays the command list every frame, as the distance-sorted passes do
   */
  useBundles: boolean;
  /**
   * Rebuild the draw data every frame, ignoring the dirty and count checks; required when
   * `useBundles` is `false`, since such a pass re-sorts every frame
   */
  alwaysRebuild: boolean;
  /** Optional per-batch sort; defaults to key-based `renderables.sort()` */
  sortBatch?: SortBatchFnGpu;
  /**
   * When true, the batcher skips texture-slot packing and the batch
   * texture bind group. Suitable for depth-only or solid-colour passes.
   */
  skipTextureBatching?: boolean;
}

/**
 * Prepare phase for the bundled forward passes, such as opaque and transmission
 *
 * For each batch whose draw data is stale, sorts, fills the instance buffer, builds the
 * draw-command list and uploads the instance buffer, all **before** any render target is bound.
 *
 * Split out of `renderForwardBatchesGpu` so a cull compute can run between the
 * uploads here and the bundle replay there (compute can't run inside a render
 * pass). Runs in the graph's execute pre-sweep. Immediate-replay passes
 * (`useBundles === false`) have no bundle to hoist into and prepare inline in
 * `renderForwardBatchesGpu`, so this returns immediately for them.
 *
 * The list's own draw args stay on the CPU. They are the template each `CullResult` copies its
 * lanes from in `CullResult.sync`, and only a result's copy is ever drawn. A rebuild moves the
 * command list's dirty id, which is what makes every result re-sync and re-record.
 *
 * The cull producer is resolved here, on rebuild only. It depends on the batch's `cull` mode and
 * its instance count, and a change to either forces a rebuild: the `cull` setter invalidates the
 * batch's draw lists.
 *
 * The draw claim (`claimDrawBuilt`) is left for `renderForwardBatchesGpu`. The graph can still
 * invalidate bundles between prepare and render, when it binds a new sampled texture source.
 * @param options - The pass's pipe, bit, session, and draw-cache policy
 * @internal
 */
export function prepareForwardBatchesGpu(options: RenderForwardBatchesGpuOptions): void {
  const { pipe, bit, session, useBundles, alwaysRebuild, sortBatch, skipTextureBatching = false } = options;

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

    gpuData.instanceBuffer.upload(renderables.count);

    list._cullProducer = resolveCullProducer(batch.cull, true, renderables.count);
  }
}

/**
 * Compute phase for bundled forward passes: fill each batch's survivors for this pass, between
 * the prepare uploads and the render's `drawIndexedIndirect`
 *
 * Each batch's `CullResult` is first re-synced to its list if prepare rebuilt it. Then the
 * producer prepare resolved decides who fills its survivors; bundles always bind them:
 *
 * - `'off'` runs the visibility-only walk, and only when its answer could have changed: the
 *   batch's visibility dirty id moved, or the sync reset the result's watermark. Otherwise last
 *   frame's survivors still stand. The frustum producers can't skip like this, because the camera
 *   is one of their inputs and has no change signal.
 * - `'cpu'` runs the frustum cull in JavaScript, `produceCpuCompaction`.
 * - `'gpu'` records the compaction compute, which `ComputeSystemGpu.renderEnd` submits ahead of
 *   the render. The frustum is moved into the batch's frame once, as the CPU cull does, so the
 *   kernel never combines the batch matrix with each instance's.
 *
 * The compute reads bounds from the per-geometry store; the CPU cull reads each instance's
 * cached sphere instead. Results for batches the view detached go back to the pool first.
 * Immediate-replay passes compact inline in `renderForwardBatchesGpu`, so this returns for them.
 * @param options - The pass's pipe, bit, session, cull results, and draw-cache policy
 * @internal
 */
export function computeForwardBatchesGpu(options: RenderForwardBatchesGpuOptions): void {
  const { pipe, bit, cullResults, session, useBundles } = options;
  if (!useBundles) return;

  const { view3d } = session;
  const boundsBuffer = pipe.geometryDataStoreBuffer.buffer;
  const planes = (options.camera ?? view3d.camera).cullFrustum.planesData;

  cullResults.removeDetached(view3d);

  for (const batch of view3d._meshBatches) {
    if (!batch.renderData._worldVisible) continue;
    const list = batch.drawLists[bit];
    if (!list || list.view.count === 0) continue;

    const result = cullResults.ensure(batch);
    result.sync(list);

    const producer = list._cullProducer;
    if (producer === 'off') {
      if (result.lastVisibilityDirtyId !== batch._visibilityDirtyId) {
        produceCpuCompaction(list, batch, null, result);
      }
      continue;
    }
    if (producer === 'cpu') {
      produceCpuCompaction(list, batch, planes, result);
      continue;
    }

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
 * the compute phase. Here it binds slots 10 and 11 and records the result's bundle if needed,
 * now that the graph has bound this pass's sampled textures, so the bundle captures the right
 * bind-group state. A bundle is re-recorded when the list's `bundleDirtyId` moved (a sampled
 * texture swap re-records without rebuilding the command list), when the camera group differs
 * from the one it baked, or when `encoder.isBundleValid` finds its target stamp (attachment
 * state and winding) no longer matches. Every producer fills the survivors, `'off'` included, so
 * a producer change never invalidates a bundle. The valid bundles replay in one `executeBundle`
 * call after the batch walk, because WebGPU resets the pass state after every call. A bundle
 * replay binds nothing, so pixi's GC never sees the resources it uses; `commandList.touch`
 * stamps them, or the GC would free a texture drawn every frame.
 *
 * Immediate-replay passes, such as transparent, have no prepare phase. They sort and build
 * inline, then re-sync the result to the rebuilt command list, which re-copies its lanes and
 * re-sizes its survivors before anything binds them. Then they run the same compaction as the
 * bundled passes: always visibility, and the frustum above the `'auto'` gate. Their detached
 * results are dropped here, since they have no compute phase.
 * A `'gpu'` compaction is recorded now and submitted in `ComputeSystemGpu.renderEnd`, ahead of
 * the render, so the replayed indirect draws read the compacted counts.
 *
 * Slot 10 holds the batch's store and slot 11 this pass's survivors for the batch, as
 * `[id, texSlots]` records. Passes with a different shape (shadow, background, copy-opaque)
 * implement `render()` themselves and don't call this.
 *
 * Invariant: `useBundles === false` requires `alwaysRebuild === true` — an
 * immediate replay that skipped rebuild would replay against the previous
 * batch's slot-10/11 bindings. Bundles capture their bindings at record time.
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
  const planes = camera.cullFrustum.planesData;
  const boundsBuffer = pipe.geometryDataStoreBuffer.buffer;

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
        session.globalBindGroup.setResource(batch.storeBuffer.bufferResource, 10);
        session.globalBindGroup.setResource(result.survivors.bufferResource, 11);
        encoder.beginBundle(`view3d pass ${bit} batch ${batch.uid}`);
        list.commandList.replay(encoder, pipe.renderer.buffer, result.indirectDrawData, cameraData);
        result.bundle = encoder.endBundle();
        result.claimBundleRecorded(list, cameraData.bindGroup);
      }
    } else if (drawRebuilt) {
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

      result.sync(list);

      session.globalBindGroup.setResource(batch.storeBuffer.bufferResource, 10);
      session.globalBindGroup.setResource(result.survivors.bufferResource, 11);

      const producer = resolveCullProducer(batch.cull, true, renderables.count);
      list._cullProducer = producer;
      if (producer === 'gpu') {
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
      list.commandList.touch(gcNow);
      bundleRun[bundleIndex++] = result.bundle!;
    } else {
      list.commandList.replay(encoder, pipe.renderer.buffer, result.indirectDrawData, cameraData);
    }
  }

  if (bundleIndex > 0) {
    encoder.executeBundle(bundleRun);
    bundleRun.length = 0;
  }
}

/**
 * Scratch for the pass's valid bundles, replayed in a single `executeBundle` call
 *
 * Module-scoped and emptied right after each replay, so it holds no bundle between calls: a
 * retained bundle would pin every GPU resource it recorded. Passes render one at a time, so it is
 * never live for two at once. pixi's global resource teardown empties it too.
 */
const bundleRun: RenderBundle[] = [];
GlobalResourceRegistry.register({
  clear: () => {
    bundleRun.length = 0;
  },
});
