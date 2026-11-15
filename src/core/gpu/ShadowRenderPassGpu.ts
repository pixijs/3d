import type { RenderBundle, WebGPURenderer } from 'pixi.js';

import { stateFor3D } from '../../materials/BaseMaterial3D';
import type { ShadowData } from '../../scene/lights/Light';
import { cpuSubmissionLimit, resolveCullProducer, transformFrustumToBatch } from '../cull';
import type { DepthHandle } from '../render-graph/ResourceHandle';
import { CullResults } from '../render-passes/CullResults';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { RenderSession } from '../render-passes/RenderSession';
import { MAX_CASCADES } from '../render-passes/shadow/csmUtils';
import { cascadeCountFor, castsShadowThisFrame } from '../render-passes/shadow/shadowPassUtils';
import { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import { DEPTH_EMPTY } from '../textures/DefaultTextures';
import { produceCpuCompaction, produceVisibilityCompaction } from './cull';
import { bindBatchStorage } from './renderForwardBatchesGpu';
import type { View3DPipeGpu } from './View3DPipeGpu';

interface ShadowRenderPassGpuOptions {
  renderer: WebGPURenderer;
  shadowMapHandle: DepthHandle;
}

/**
 * WebGPU's `ShadowData`: the shared cascade slots plus this light's cull results
 *
 * Code can read a light's `_gpuShadowData` into a `ShadowDataGpu` variable without a cast, since
 * `cullResults`, the one field this type adds, is optional.
 * @internal
 */
export interface ShadowDataGpu extends ShadowData {
  /** One per batch per cascade, owned by the light and released with it by `releaseShadowCascades` */
  cullResults?: CullResults;
}

/** @internal */
export class ShadowRenderPassGpu extends ShadowRenderPassBase<View3DPipeGpu, ShadowDataGpu> {
  /** Emptied after each replay; `bundleRun` in `renderForwardBatchesGpu.ts` says why */
  private readonly _bundleRun: RenderBundle[] = [];

  constructor(options: ShadowRenderPassGpuOptions) {
    const shadowState = stateFor3D();
    shadowState.depthTest = true;
    shadowState.depthMask = true;
    shadowState.culling = true;
    shadowState.clockwiseFrontFace = false;
    shadowState.blend = false;

    super({
      renderer: options.renderer,
      name: 'shadow',
      description: 'Renders shadow-casting scene geometry into each light shadow map.',
      bit: RenderPassBit.SHADOW,
      shadowMapHandle: options.shadowMapHandle,
      level: 'cutout',
      descriptor: {
        state: shadowState,
      },
    });
  }

  protected override readonly _applyZRangeFix = true;

  /**
   * Binds the shadow map before anything claims a bundle version, since binding a new map re-records
   * every bundle, and drops detached batches' results for every light, casting this frame or not
   */
  public override prepare(session: RenderSession): void {
    const { view3d, lights } = session;

    this._bindShadowSource(view3d, this.renderTarget.depthStencilTexture!);

    const batcher = this.pipe.renderer.material3d.batcher;
    const computeSystem = this.pipe.renderer.compute3d;
    const boundsBuffer = this.pipe.geometryDataStoreBuffer.buffer;

    for (const batch of view3d._meshBatches) {
      if (!batch.renderData._worldVisible) continue;
      const list = batch.drawLists[this.bit];
      if (!list) continue;
      const gpuData = list.gpuData;
      const renderables = list.view;

      if (renderables.count === 0) {
        list.claimDrawEmpty();
        continue;
      }

      if (list.nextBuild(view3d._updateTick)) {
        list.claimDrawBuilt();
        gpuData.instanceBuffer.populateIds(renderables);

        batcher.render({
          renderables,
          globalBindGroup: session.globalBindGroup,
          commandList: list.commandList,
          drawData: list.drawData,
          passBit: this.bit,
          batch,
          view3d,
        });

        gpuData.instanceBuffer.upload(renderables.count);
      }
    }

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      const data: ShadowDataGpu | null = light._gpuShadowData;
      if (!data) continue;

      data.cullResults?.removeDetached(view3d);

      if (!castsShadowThisFrame(light)) continue;

      const cascadeCount = cascadeCountFor(light);
      const cascades = data.cascades;
      const results = (data.cullResults ??= new CullResults());
      const cpuSubmission = cpuSubmissionLimit('shadow');

      for (let c = 0; c < cascadeCount; c++) {
        const slot = cascades?.[c];
        if (!slot || !slot.needsRender) continue;

        const frustum = slot.cameraData.frustum;

        for (const batch of view3d._meshBatches) {
          if (!batch.renderData._worldVisible) continue;
          const list = batch.drawLists[this.bit];
          if (!list || list.view.count === 0) continue;

          if (c === 0) for (let s = cascadeCount; s < MAX_CASCADES; s++) results.remove(batch, s);
          const direct = list.view.count <= cpuSubmission;
          const result = results.ensure(batch, c);
          result.sync(list, direct);

          const producer = resolveCullProducer(batch.cull, !direct);
          if (producer === 'off') {
            produceVisibilityCompaction(computeSystem, list, batch, boundsBuffer, result);
          } else if (producer === 'cpu') {
            produceCpuCompaction(list, batch, frustum.planesData, result);
          } else {
            const batchPlanes = transformFrustumToBatch(frustum.planesData, batch.storeBuffer.data);
            computeSystem.dispatch(
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
      }
    }
  }

  /**
   * Main render loop
   *
   * For each shadow-casting light, iterates its cascades (or its single layer) and renders the
   * casters' depth into the matching layer of the shadow-map array. A cascade the update cadence
   * skipped this frame keeps its depth layer and frozen matrix. Colour writes are masked off for
   * the whole pass, so every bundle records under that mask.
   *
   * Draw data was built in `prepare`. Here each cascade binds its layer, a pass of its own, with
   * `bind` rather than `push`: the graph re-establishes the default target after this pass, so
   * there is nothing to pop back to. Every light draws through its cascades' camera groups; spot
   * lights and fixed boxes use slot 0, like a lone directional. Each cascade binds its own cull
   * result, the survivors and args `prepare` filled for it, and records or replays its bundle,
   * cached on that result until the list rebuilds or the map is recreated. An indirect bundle holds
   * the body's commands only; the tail's, after `commandList.bodyCount`, draw straight into the
   * cascade's pass every frame, so a tail command added or emptied records nothing.
   * When the batch's cull is `'off'`, a result the cascade draws direct (`CullResult.direct`) has its direct draws recorded
   * into that bundle, which also re-records when `CullResult.countsDirtyId` moves. Otherwise the
   * cascade issues those draws straight into its pass every frame, with no bundle, and binding
   * their groups stamps what they use for pixi's GC. A light or batch with no result was skipped
   * by `prepare` this frame and draws nothing. `isBundleValid` vets the state a bundle baked
   * (attachment formats, sample count, winding), which the shadow target keeps fixed; a replaced
   * map isn't part of that stamp, and `_bindShadowSource` re-records for it.
   *
   * The cascade's recorded bundles bake its camera group's buffer and replay it without touching
   * it, and a throttled cascade never re-uploads, so pixi's GC would see an idle buffer and free it
   * under a live bundle. The buffer opts out of the GC; `releaseShadowCascades` frees it instead.
   *
   * Every shader drawn here is compiled with the full global bit, so its layout holds `uShadowMap`,
   * and WebGPU rejects a texture bound for sampling in a render pass that also has it as the depth
   * attachment. So the slot holds `DEPTH_EMPTY` while the cascades draw, and the live map goes back
   * once they have. The swap re-records nothing, unlike `_bindShadowSource`: the bundles recorded
   * here bake the placeholder, every other pass draws and records while the slot holds the live
   * map, and the next `prepare` finds the live map already bound. Both halves use
   * `setResourceUnwatched`, so the swap moves no `change` listener: the live map keeps the one
   * `_bindShadowSource` gave it, and the placeholder is never destroyed.
   *
   * A cascade's valid bundles replay in one `executeBundle` call, and the scratch run is emptied
   * right after, so it holds no bundle, and so no GPU resource, past the cascade. Once a light's
   * due cascades are drawn, its layers belong to the live map and its one-shot refresh is spent.
   * The last bind leaves the shadow map as the live target, so `activeTarget` is reset for the
   * next pass to bind its own, as `CopyOpaquePass` does.
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    const { view3d, lights } = session;

    const renderer = this.pipe.renderer;
    const encoder = renderer.encoder;
    const pipeline = renderer.pipeline;
    const { group, slot } = view3d._graph.globalTextureBindings.shadowMap;
    const shadowMapIndex = group.layout![slot];

    group.setResourceUnwatched(DEPTH_EMPTY.source, shadowMapIndex);
    pipeline.setColorMask(0b0000);

    for (const light of lights) {
      if (!castsShadowThisFrame(light)) continue;
      const data = this.getShadowGPUData(light);
      const results = data.cullResults;
      if (!results) continue;

      const cascadeCount = cascadeCountFor(light);

      for (let c = 0; c < cascadeCount; c++) {
        const cascade = this._cascadeSlot(light, c);

        if (!cascade.needsRender) continue;

        const layerIndex = light._shadowDataIndex + c;

        const cameraBindGroup = cascade.cameraData.bindGroup;

        renderer.renderTarget.bind({ target: this.renderTarget, clear: true, layer: layerIndex });

        renderer.ubo.updateUniformGroup(cascade.cameraData.uniformGroup);
        cascade.cameraData.uniformGroup.buffer!.autoGarbageCollect = false;

        for (const batch of view3d._meshBatches) {
          if (!batch.renderData._worldVisible) continue;
          const list = batch.drawLists[this.bit];
          if (!list || list.view.count === 0) continue;

          const result = results.get(batch, c);
          if (!result) continue;

          if (result.direct && batch.cull !== 'off') {
            result.bundle = null;
            bindBatchStorage(session, batch, result);
            list.commandList.replayDirect(encoder, result.indirectDrawData, cascade.cameraData);
            continue;
          }

          const recorded = result.bundle;

          if (!recorded || result.isBundleStale(list, cameraBindGroup) || !encoder.isBundleValid(recorded)) {
            bindBatchStorage(session, batch, result);

            encoder.beginBundle(`shadow cascade ${c} batch ${batch.uid}`);
            if (result.direct) list.commandList.replayDirect(encoder, result.indirectDrawData, cascade.cameraData);
            else {
              list.commandList.replay(
                encoder,
                renderer.buffer,
                result.indirectDrawData,
                cascade.cameraData,
                0,
                list.commandList.bodyCount,
              );
            }
            result.bundle = encoder.endBundle();
            result.claimBundleRecorded(list, cameraBindGroup);
          }

          const commandList = list.commandList;
          commandList.touch(renderer.gc.now);
          this._bundleRun.push(result.bundle!);
          if (!result.direct && commandList.count > commandList.bodyCount) {
            bindBatchStorage(session, batch, result);
            commandList.replay(
              encoder,
              renderer.buffer,
              result.indirectDrawData,
              cascade.cameraData,
              commandList.bodyCount,
            );
          }
        }

        if (this._bundleRun.length > 0) {
          encoder.executeBundle(this._bundleRun);
          this._bundleRun.length = 0;
        }
      }

      this._completeShadowUpdate(light);
    }

    pipeline.setColorMask(0b1111);
    group.setResourceUnwatched(this.renderTarget.depthStencilTexture!, shadowMapIndex);

    session.activeTarget = null;
  }
}
