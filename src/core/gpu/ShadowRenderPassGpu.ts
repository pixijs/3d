import { BindGroup } from 'pixi.js';
import type { RenderBundle, WebGPURenderer } from 'pixi.js';

import { stateFor3D } from '../../materials/BaseMaterial3D';
import type { ShadowData } from '../../scene/lights/Light';
import { EMPTY_BUFFER_RESOURCE } from '../buffers/emptyBufferResource';
import { resolveCullProducer, transformFrustumToBatch } from '../cull';
import type { DepthHandle } from '../render-graph/ResourceHandle';
import { CullResults } from '../render-passes/CullResult';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { RenderSession } from '../render-passes/RenderSession';
import { MAX_CASCADES } from '../render-passes/shadow/csmUtils';
import { cascadeCountFor, castsShadowThisFrame } from '../render-passes/shadow/shadowPassUtils';
import { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';
import { produceCpuCompaction } from './cull';
import { shadowGlobalBitGpu } from './shader/shadowGlobalBitGpu';
import type { View3DPipeGpu } from './View3DPipeGpu';

/**
 * Constructor options for `ShadowRenderPassGpu`
 * @internal
 */
interface ShadowRenderPassGpuOptions {
  /** The owning WebGPU renderer */
  renderer: WebGPURenderer;
  /** The graph's handle for the shadow-map array; `ShadowRenderPassBase#shadowMapHandle` describes it */
  shadowMapHandle: DepthHandle;
}

/**
 * The WGSL module every shadow caster is drawn with: the vertex stage of the material template
 * with only the position kept, and an empty fragment stage
 *
 * It declares `normal` and `tangent` because the morph and skinning bits it shares with the
 * material template write them, so their types must match that template's. The compiler drops
 * the unused math.
 */
const shadowGpuTemplate = /*wgsl*/ `

{{header}}
{{vertexHeader}}

@vertex
fn mainVertex(
  input: VertexInput,
  @builtin(instance_index) ii: u32,
  @builtin(vertex_index) vid: u32
) -> VertexOutput {
  var output: VertexOutput;

  var position: vec4<f32>;

  let renderable = uRenderableStorage[uRenderableInstanceStorage[ii].id];
  let batchWorldMatrix = uRenderableStorage[0].transform;

  var normal = vec3<f32>(0.0);
  var tangent = vec3<f32>(0.0);

  {{vertexInput}}

  let worldPosition = batchWorldMatrix * renderable.transform * position;
  let clipPosition = camera.uViewProjectionMatrix * worldPosition;

  output.position = clipPosition;

  {{vertexEnd}}

  return output;
}

@fragment
fn mainFragment(input: FragmentInput){
}
`;

const shadowTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'camera', 'local'],
  gpu: shadowGpuTemplate,
};

/**
 * WebGPU's `ShadowData`: the shared cascade slots plus this light's cull results
 * @internal
 */
interface ShadowDataGpu extends ShadowData {
  /**
   * This light's cull results — one per batch per cascade: the casters inside that cascade's
   * volume, their indirect counts, and the cascade's bundle for the batch
   *
   * Owned by the light so removing it drops everything at once: a removed light can never leave
   * a bundle bound to a freed survivor buffer, regardless of how the light list reorders. Batches
   * that leave the view are reclaimed by `CullResults.removeDetached`. WebGPU-only.
   */
  cullResults?: CullResults;
}

/**
 * Cascaded Shadow Maps render pass (WebGPU)
 *
 * A directional light with `shadow.cascades` set renders up to four stable-fit cascades; one
 * without renders a single fixed box, `shadow.bounds` or one fitted to the casters. A spot light
 * renders one perspective map. Point lights cast no shadows and never reach the pass.
 *
 * Casters are re-rasterised into each cascade per frame unless the resolved
 * `shadow.update` cadence throttles it (see `updateLightShadowData`). The
 * shadow map is a baked depth texture, so a moving caster must be redrawn; the
 * per-batch render bundles are still cached and only re-recorded on structural
 * change, so a moving caster costs a bundle replay against the freshly-uploaded
 * transform storage, not a re-sort.
 * @internal
 */
export class ShadowRenderPassGpu extends ShadowRenderPassBase<View3DPipeGpu, ShadowDataGpu> {
  /** Scratch for a cascade's valid bundles, replayed in a single `executeBundle` call and emptied right after */
  private readonly _bundleRun: RenderBundle[] = [];

  /**
   * The pass's group 0 — the scene data every shadow draw reads, whatever camera it draws from
   *
   * One for the pass, not one per cascade: the cascade's own matrices live in its camera group at
   * group 1. Its bindings follow `shadowGlobalBitGpu`'s order. `render` re-points all five before
   * recording each bundle: the batch's mesh store and the cascade's survivors at 0 and 1 change
   * per batch and cascade, and the bone pit and the morph and geometry stores at 2 to 4 are set
   * again so a bundle re-recorded after a store grew bakes the live buffer, not the retired one.
   */
  private readonly _globalBindGroup = new BindGroup({
    0: EMPTY_BUFFER_RESOURCE,
    1: EMPTY_BUFFER_RESOURCE,
    2: EMPTY_BUFFER_RESOURCE,
    3: EMPTY_BUFFER_RESOURCE,
    4: EMPTY_BUFFER_RESOURCE,
  });

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
      descriptor: {
        shaderDescriptor: {
          bitsGpu: [shadowGlobalBitGpu],
          template: shadowTemplate,
          includeGlobal: false,
        },
        state: shadowState,
      },
    });
  }

  /** WebGPU remaps shadow depth to the [0,1] range */
  protected override readonly _applyZRangeFix = true;

  /**
   * Prepare phase — runs in the graph pre-sweep with no render target bound, so the cull
   * compute can dispatch between the uploads here and the bundle replay in `render`
   *
   * Two sweeps:
   *
   * **Sweep 1** is per batch and the same for every light: (re)build the draw list once per
   * structural rebuild (cascade- and light-independent — every cascade of every light draws the
   * same casters, only the VP differs) and resolve the cull producer.
   *
   * **Sweep 2** is per light: drop its results for detached batches (for every
   * light with results — a dormant light must still release removed batches), then, per cascade
   * that renders this frame, sync each batch's result to the list and fill it: a frustum cull
   * into *that cascade's own* result, on the CPU or as a compute dispatch
   * `ComputeSystemGpu.renderEnd` submits — each map rasterises only casters inside its own volume,
   * and throttled cascades cull nothing by construction — or, with no frustum producer, the
   * visibility-only walk, dirty-gated per result so it only re-runs when something was hidden or
   * shown. The cull matches what `render` draws, and a cascade whose cull hasn't run yet draws
   * its synced full counts, which is conservative, never wrong. A light that lost cascades hands
   * the surplus results back to the pool.
   *
   * The shadow map is bound to the global group first, before either sweep claims a bundle
   * version. The `renderTarget` getter mints a new map after a release or a quality change
   * (applied at the frame boundary by `beginFrame`), and binding it re-records every bundle that
   * baked the old one. The graph would catch that for a binding it tracks, but this one the pass
   * sets itself.
   * @param session - The current frame's render session
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
        list._cullProducer = 'off';
        continue;
      }

      if (list.isDrawStale(renderables.count)) {
        list.claimDrawBuilt(renderables.count);

        renderables.sort();
        gpuData.instanceBuffer.populateIds(renderables);

        batcher.render({
          renderables,
          globalBindGroup: this._globalBindGroup,
          instanceData: gpuData.instanceBuffer.data,
          commandList: list.commandList,
          drawData: list.drawData,
          passBit: this.bit,
          skipTextureBatching: true,
        });

        gpuData.instanceBuffer.upload(renderables.count);
      }

      list._cullProducer = resolveCullProducer(batch.cull, true, renderables.count);
    }

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      const data = light._gpuShadowData as ShadowDataGpu | null;
      if (!data) continue;

      data.cullResults?.removeDetached(view3d);

      if (!castsShadowThisFrame(light)) continue;

      const cascadeCount = cascadeCountFor(light);
      const cascades = data.cascades;
      const results = (data.cullResults ??= new CullResults());

      for (let c = 0; c < cascadeCount; c++) {
        const slot = cascades?.[c];
        if (!slot || !slot.needsRender) continue;

        const frustum = slot.cameraData.frustum;

        for (const batch of view3d._meshBatches) {
          if (!batch.renderData._worldVisible) continue;
          const list = batch.drawLists[this.bit];
          if (!list || list.view.count === 0) continue;

          if (c === 0) for (let s = cascadeCount; s < MAX_CASCADES; s++) results.remove(batch, s);
          const result = results.ensure(batch, c);
          result.sync(list);

          const producer = list._cullProducer;
          if (producer === 'off') {
            if (result.lastVisibilityDirtyId !== batch._visibilityDirtyId) {
              produceCpuCompaction(list, batch, null, result);
            }
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
   * cached on that result until the list rebuilds or the map is recreated. A light or batch with
   * no result was skipped by `prepare` this frame and draws nothing. `isBundleValid` vets the
   * state a bundle baked (attachment formats, sample count, winding), which the shadow target keeps
   * fixed; a replaced map isn't part of that stamp, and `_bindShadowSource` re-records for it.
   *
   * The cascade's recorded bundles bake its camera group's buffer and replay it without touching
   * it, and a throttled cascade never re-uploads, so pixi's GC would see an idle buffer and free it
   * under a live bundle. The buffer opts out of the GC; `releaseShadowCascades` frees it instead.
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

          const recorded = result.bundle;

          if (!recorded || result.isBundleStale(list, cameraBindGroup) || !encoder.isBundleValid(recorded)) {
            const globalBindGroup = this._globalBindGroup;

            globalBindGroup.setResource(batch.storeBuffer.bufferResource, 0);
            globalBindGroup.setResource(result.survivors.bufferResource, 1);
            globalBindGroup.setResource(view3d._bonePit.bufferResource, 2);
            globalBindGroup.setResource(this.pipe._morphStoreBuffer.bufferResource, 3);
            globalBindGroup.setResource(this.pipe.geometryDataStoreBuffer.bufferResource, 4);

            encoder.beginBundle(`shadow cascade ${c} batch ${batch.uid}`);
            list.commandList.replay(encoder, renderer.buffer, result.indirectDrawData, cascade.cameraData);
            result.bundle = encoder.endBundle();
            result.claimBundleRecorded(list, cameraBindGroup);
          }

          list.commandList.touch(renderer.gc.now);
          this._bundleRun.push(result.bundle!);
        }

        if (this._bundleRun.length > 0) {
          encoder.executeBundle(this._bundleRun);
          this._bundleRun.length = 0;
        }
      }

      this._completeShadowUpdate(light);
    }

    pipeline.setColorMask(0b1111);

    session.activeTarget = null;
  }

  /**
   * Drops group 0's references along with the shadow map: the stores it points at belong to the
   * pipe and the batches, and the pipe frees them when its renderer dies while this View lives on
   */
  public override unload(): void {
    for (let i = 0; i < 5; i++) this._globalBindGroup.setResource(EMPTY_BUFFER_RESOURCE, i);
    super.unload();
  }

  /**
   * Releases the pass-owned group 0 (the scene buffers every shadow draw reads)
   *
   * `super.destroy()` frees the inherited shadow-map render target. The buffers this group binds
   * are owned elsewhere — the batch stores by their batches, the morph and geometry stores by the
   * pipe, the bone pit by the View — so only the group's own listeners go. Per-cascade camera
   * groups belong to their lights and are freed by `releaseShadowCascades`.
   */
  public override destroy(): void {
    if (this._destroyed) return;

    this._globalBindGroup.destroy();

    super.destroy();
  }
}
