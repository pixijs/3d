import { GlobalResourceRegistry } from 'pixi.js';
import type { RenderBundle } from 'pixi.js';

import type { Vector3 } from '../../math/vector/Vector3';
import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { Mesh3DBatch } from '../batcher/Mesh3DBatch';
import type { Mesh3DData } from '../batcher/Mesh3DData';
import type { SortedMesh3DView } from '../batcher/SortedMesh3DView';
import { EMPTY_BUFFER_RESOURCE } from '../buffers/emptyBufferResource';
import { getCameraData } from '../CameraData';
import { cpuSubmissionLimit, resolveCullProducer, transformFrustumToBatch } from '../cull';
import type { CullResult } from '../render-passes/CullResult';
import type { CullResults } from '../render-passes/CullResults';
import type { RenderSession } from '../render-passes/RenderSession';
import { produceCpuCompaction, produceVisibilityCompaction } from './cull';
import type { View3DPipeGpu } from './View3DPipeGpu';

type SortBatchFnGpu = (renderables: SortedMesh3DView<Mesh3DData>, batch: Mesh3DBatch, cameraPosition: Vector3) => void;

interface RenderForwardBatchesGpuOptions {
  pipe: View3DPipeGpu;
  bit: number;
  bindsMaterial: boolean;
  cullResults: CullResults;
  /** `null` for the view's own camera */
  camera: Camera3D | null;
  session: RenderSession;
  useBundles: boolean;
  /** `undefined` sorts by key */
  sortBatch?: SortBatchFnGpu;
}

/**
 * Rebuilds stale draw data before any render target is bound, so the cull compute can run before the
 * draws; `computeForwardBatchesGpu`, run right after for the same pass, claims the lists
 * @internal
 */
export function prepareForwardBatchesGpu(options: RenderForwardBatchesGpuOptions): void {
  const { pipe, bit, bindsMaterial, session, useBundles, sortBatch } = options;

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

    if (!(sortBatch ? list.isDrawStale() : list.nextBuild(view3d._updateTick))) continue;

    if (sortBatch) sortBatch(renderables, batch, cameraPosition);

    const gpuData = list.gpuData;
    gpuData.instanceBuffer.populateIds(renderables);

    batcher.render({
      renderables,
      globalBindGroup: session.globalBindGroup,
      commandList: list.commandList,
      drawData: list.drawData,
      passBit: bit,
      bindsMaterial,
      batch,
      view3d,
    });

    gpuData.instanceBuffer.upload(renderables.count);
  }
}

/**
 * Claims each list first, so the other passes on the bit reuse it rather than rebuild it. Only
 * `'off'` may skip a frame; the frustum producers can't, as the camera has no change signal.
 * @internal
 */
export function computeForwardBatchesGpu(options: RenderForwardBatchesGpuOptions): void {
  const { pipe, bit, cullResults, session, useBundles } = options;
  if (!useBundles) return;

  const { view3d } = session;
  const cpuSubmission = cpuSubmissionLimit('forward');
  const boundsBuffer = pipe.geometryDataStoreBuffer.buffer;
  const planes = (options.camera ?? view3d.camera).cullFrustum.planesData;

  cullResults.removeDetached(view3d);

  for (const batch of view3d._meshBatches) {
    if (!batch.renderData._worldVisible) continue;
    const list = batch.drawLists[bit];
    if (!list || list.view.count === 0) continue;

    list.claimDrawBuilt();

    const direct = list.view.count <= cpuSubmission;
    const result = cullResults.ensure(batch);
    result.sync(list, direct);

    const producer = resolveCullProducer(batch.cull, !direct);
    if (producer === 'off') {
      produceVisibilityCompaction(pipe.renderer.compute3d, list, batch, boundsBuffer, result);
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
 * Replays the valid bundles in one `executeBundle` after the walk, since WebGPU resets the pass state
 * after each call. Only an `'off'` batch bundles its direct draws; a culled one's counts change every frame.
 * An immediate pass binds each batch's storage every frame, rebuilt or not.
 * @internal
 */
export function renderForwardBatchesGpu(options: RenderForwardBatchesGpuOptions): void {
  const { pipe, bit, bindsMaterial, cullResults, session, useBundles, sortBatch } = options;

  const { view3d } = session;
  const encoder = pipe.renderer.encoder;
  const batcher = pipe.renderer.material3d.batcher;
  const gcNow = pipe.renderer.gc.now;
  const camera = options.camera ?? view3d.camera;
  const cameraData = getCameraData(camera);
  const planes = camera.cullFrustum.planesData;
  const boundsBuffer = pipe.geometryDataStoreBuffer.buffer;
  const cpuSubmission = cpuSubmissionLimit('forward');

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

    const result = cullResults.ensure(batch);

    if (useBundles && result.direct && batch.cull !== 'off') {
      result.bundle = null;
      bindBatchStorage(session, batch, result);
      list.claimDrawBuilt();
      list.commandList.replayDirect(encoder, result.indirectDrawData, cameraData);
      continue;
    }

    if (useBundles) {
      const recorded = result.bundle;

      if (!recorded || result.isBundleStale(list, cameraData.bindGroup) || !encoder.isBundleValid(recorded)) {
        bindBatchStorage(session, batch, result);
        encoder.beginBundle(`view3d pass ${bit} batch ${batch.uid}`);
        if (result.direct) list.commandList.replayDirect(encoder, result.indirectDrawData, cameraData);
        else {
          list.commandList.replay(
            encoder,
            pipe.renderer.buffer,
            result.indirectDrawData,
            cameraData,
            0,
            list.commandList.bodyCount,
          );
        }
        result.bundle = encoder.endBundle();
        result.claimBundleRecorded(list, cameraData.bindGroup);
      }
    } else {
      let rebuild = true;
      if (sortBatch) {
        sortBatch(renderables, batch, cameraData.position);
        rebuild = list.isDrawStale() || list.isOrderStale();
      } else {
        list.nextBuild(view3d._updateTick, true);
      }
      const gpuData = list.gpuData;

      if (rebuild) {
        gpuData.instanceBuffer.populateIds(renderables);

        batcher.render({
          renderables,
          globalBindGroup: session.globalBindGroup,
          commandList: list.commandList,
          drawData: list.drawData,
          passBit: bit,
          bindsMaterial,
          batch,
          view3d,
        });

        gpuData.instanceBuffer.upload(renderables.count);
      }

      const direct = renderables.count <= cpuSubmission;
      result.sync(list, direct);

      bindBatchStorage(session, batch, result);

      const producer = resolveCullProducer(batch.cull, !sortBatch && !direct);
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

    list.claimDrawBuilt();

    if (useBundles) {
      const commandList = list.commandList;
      commandList.touch(gcNow);
      bundleRun[bundleIndex++] = result.bundle!;
      if (!result.direct && commandList.count > commandList.bodyCount) {
        bindBatchStorage(session, batch, result);
        commandList.replay(encoder, pipe.renderer.buffer, result.indirectDrawData, cameraData, commandList.bodyCount);
      }
    } else if (result.direct) {
      list.commandList.replayDirect(encoder, result.indirectDrawData, cameraData);
    } else {
      list.commandList.replay(encoder, pipe.renderer.buffer, result.indirectDrawData, cameraData);
    }
  }

  if (bundleIndex > 0) {
    encoder.executeBundle(bundleRun);
    bundleRun.length = 0;
  }
}

/** Binds the empty buffer for a batch with no instance store, so no draw reads another batch's store */
function bindBatchStorage(session: RenderSession, batch: Mesh3DBatch, result: CullResult): void {
  session.globalBindGroup.setResource(batch.storeBuffer.bufferResource, 'uRenderableStorage');
  session.globalBindGroup.setResource(result.survivors.bufferResource, 'uRenderableInstanceStorage');
  session.globalBindGroup.setResource(
    batch.instanceStoreBuffer?.bufferResource ?? EMPTY_BUFFER_RESOURCE,
    'uInstanceStorage',
  );
}

/** Emptied after each replay, since a bundle held between calls pins every resource it recorded */
const bundleRun: RenderBundle[] = [];
GlobalResourceRegistry.register({
  clear: () => {
    bundleRun.length = 0;
  },
});
