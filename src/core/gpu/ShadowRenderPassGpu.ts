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
  /**
   * Graph-imported handle for the cascaded shadow-map array texture
   *
   * The pass owns the underlying `TextureSource` (lazy-allocated via `this.renderTarget`,
   * reallocated on quality changes); the handle is the graph's tracking reference, registered in
   * `createDefaultGraph3D` via `graph.importDepth(() => pass.renderTarget.depthStencilTexture)`.
   */
  shadowMapHandle: DepthHandle;
}

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

  // Not needed for shadow mapping, but skinningBitGpu expects them.
  // The compiler optimizes away the unused calculations. Types must track the
  // forward template's — the skinning and morph bits are shared between both.
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
 * Directional lights render 1–4 stable-fit cascades (a light with no `cascades`
 * set is a single stable-fit cascade); spot lights render one perspective map.
 * Point lights are unsupported and filtered out upstream.
 *
 * Casters are re-rasterised into each cascade per frame unless the resolved
 * `shadow.update` cadence throttles it (see `updateLightShadowData`). The
 * shadow map is a baked depth texture, so a moving caster must be redrawn; the
 * per-batch render bundles are still cached and only re-encoded on structural
 * change (draw version / renderable-count), so a moving caster costs a bundle
 * replay against the freshly-uploaded transform storage — not a re-sort.
 * @internal
 */
export class ShadowRenderPassGpu extends ShadowRenderPassBase<View3DPipeGpu, ShadowDataGpu> {
  /** Scratch for a cascade's valid bundles, replayed in a single `executeBundle` call and emptied right after */
  private readonly _bundleRun: RenderBundle[] = [];

  /**
   * The pass's group 0 — the scene data every shadow draw reads, whatever camera it draws from
   *
   * One for the pass, not one per cascade: the cascade's own matrices live in its camera group at
   * group 1. Slots 0–1 (the batch's mesh store and that cascade's survivors) and 3–4 (the morph
   * and geometry stores) are re-pointed per recorded bundle in `render`, so a bundle re-recorded
   * after an arena growth bakes the live buffer rather than the retired one.
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
          // Supplies its own lighter `global` group; the full globalBitGpu would
          // collide with it (mismatched bind-group layout → crash). The camera
          // group is the standard one, so it still comes from the compiler.
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
   * into *that cascade's own* result — each map rasterises only casters inside its own volume,
   * and throttled cascades cull nothing by construction — or, with no frustum producer, the
   * visibility-only walk, dirty-gated per result so it only re-runs when something was hidden or
   * shown.
   * @param session - The current frame's render session
   */
  public override prepare(session: RenderSession): void {
    const { view3d, lights } = session;

    // Bind the map before anything claims a bundle version. The getter mints a fresh target
    // after a release or quality swap (applied at the frame boundary by `beginFrame`), and the
    // bind re-records every bundle that baked the previous one — the graph would normally
    // catch that, but it only tracks accesses declared through it and this binding is set by
    // the pass itself. Bound here rather than in `render` so the invalidation lands before
    // sweep 1 claims this pass's own bundle version.
    this._bindShadowSource(view3d, this.renderTarget.depthStencilTexture!);

    const cullOn = view3d.cull !== 'off';
    const batcher = this.pipe.renderer.material3d.batcher;
    const computeSystem = this.pipe.renderer.compute3d;
    const boundsBuffer = this.pipe.geometryDataStoreBuffer.buffer;

    // Sweep 1 — per batch, light-independent.
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

      // Frustum cull only when culling is on (auto still gates by count). Resolved per batch.
      list._cullProducer = cullOn ? resolveCullProducer(view3d.cull, true, renderables.count) : 'off';
    }

    // Sweep 2 — per light.
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      const data = light._gpuShadowData as ShadowDataGpu | null;
      if (!data) continue;

      // Stale-batch reclamation runs for every light with results — casting or not, cull on or
      // off — and costs one compare on frames where the batch list didn't change.
      data.cullResults?.removeDetached(view3d);

      if (!castsShadowThisFrame(light)) continue;

      const cascadeCount = cascadeCountFor(light);
      const cascades = data.cascades;
      const results = (data.cullResults ??= new CullResults());

      // Per cascade that renders this frame: fill every batch's result for that cascade. The cull
      // mirrors exactly what render() draws — throttled cascades cost nothing, and a cascade whose
      // cull hasn't run yet draws its synced full counts (conservative, never wrong).
      for (let c = 0; c < cascadeCount; c++) {
        const slot = cascades?.[c];
        if (!slot || !slot.needsRender) continue;

        const frustum = cullOn ? slot.cameraData.frustum : null;

        for (const batch of view3d._meshBatches) {
          if (!batch.renderData._worldVisible) continue;
          const list = batch.drawLists[this.bit];
          if (!list || list.view.count === 0) continue;

          // A light that lost cascades hands the surplus results back to the pool.
          if (c === 0) for (let s = cascadeCount; s < MAX_CASCADES; s++) results.remove(batch, s);
          const result = results.ensure(batch, c);
          result.sync(list);

          const producer = list._cullProducer;
          if (producer === 'off') {
            // No frustum volume: hidden meshes cast no shadows for any cascade, so this is the
            // visibility-only walk, dirty-gated on the batch's visibility id (the sync above resets
            // the watermark after a rebuild).
            if (result.lastVisibilityDirtyId !== batch._visibilityDirtyId) {
              produceCpuCompaction(list, batch, null, result);
            }
          } else if (producer === 'cpu') {
            produceCpuCompaction(list, batch, frustum!.planesData, result);
          } else {
            // GPU: move the frustum into the batch's frame (as the forward cull does) and dispatch the
            // compaction compute into this cascade's buffers; flushed once in ComputeSystemGpu.renderEnd.
            const batchPlanes = transformFrustumToBatch(frustum!.planesData, batch.storeBuffer.data);
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
   * For each shadow-casting light, iterates its cascades (or single layer for non-CSM) and
   * renders the shadow depth pass into the corresponding texture array layer. Draw data was
   * built in `prepare`; here we bind the cascade layer, re-point each command's group 0 to the
   * cascade UBO, and record/replay the per-cascade bundle (cached on the cascade's cull result
   * until the list rebuilds or the map is recreated). Each cascade binds its own result — the
   * survivors + args `prepare` filled for it.
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    const { view3d, lights } = session;

    const renderer = this.pipe.renderer;
    const encoder = renderer.encoder;
    const pipeline = renderer.pipeline;

    // Depth-only pass: mask colour writes once for the whole pass — every cascade
    // records its bundles under this mask. Restored after the light loop.
    pipeline.setColorMask(0b0000);

    for (const light of lights) {
      if (!castsShadowThisFrame(light)) continue;
      const data = this.getShadowGPUData(light);
      const results = data.cullResults;
      // No results means prepare skipped this light entirely — nothing staged, nothing to draw.
      if (!results) continue;

      const cascadeCount = cascadeCountFor(light);

      for (let c = 0; c < cascadeCount; c++) {
        const cascade = this._cascadeSlot(light, c);

        // A temporal update rate / manual mode skipped this cascade this frame —
        // its existing depth layer and frozen matrix stay valid.
        if (!cascade.needsRender) continue;

        const layerIndex = light._shadowDataIndex + c;

        // Every light draws from its per-cascade camera group — spot and fixed-area lights fill
        // cascade slot 0, the same as a lone directional.
        const cameraBindGroup = cascade.cameraData.bindGroup;

        // bind (not push) the cascade layer: the graph re-establishes the default
        // target after this self-managing pass, so there's nothing to pop back to.
        // Each cascade is a distinct array layer → its own pass.
        renderer.renderTarget.bind({ target: this.renderTarget, clear: true, layer: layerIndex });

        renderer.ubo.updateUniformGroup(cascade.cameraData.uniformGroup);
        // This cascade's recorded bundles bake the camera group's buffer and replay it without
        // re-fetching, while a throttled cascade never re-uploads — so pixi's GC would see an idle
        // buffer and free it under a live bundle. `releaseShadowCascades` frees it instead.
        cascade.cameraData.uniformGroup.buffer!.autoGarbageCollect = false;

        for (const batch of view3d._meshBatches) {
          if (!batch.renderData._worldVisible) continue;
          const list = batch.drawLists[this.bit];
          if (!list || list.view.count === 0) continue;

          // Replay what prepare staged. Sweep 2 synced this result under the same light/batch/cascade
          // walk, so its bundle and buffers already agree with the current draw program; a missing
          // result means prepare skipped the pair this frame — nothing staged, nothing to draw.
          const result = results.get(batch, c);
          if (!result) continue;

          // `isBundleValid` vets the pipeline state the bundle baked (attachment formats, sample
          // count, winding), which the shadow target keeps fixed. A swapped map is not part of
          // that stamp; `_bindShadowSource` re-records for it.
          const recorded = result.bundle;

          if (!recorded || result.isBundleStale(list, cameraBindGroup) || !encoder.isBundleValid(recorded)) {
            // Point group 0 at this batch's store and this cascade's survivors. The morph and
            // geometry stores are re-pointed here (not once at creation) so a bundle re-recorded
            // after an arena growth binds the live buffer, not the retired one — store growth
            // invalidates this batch/pass's bundle version.
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

        // Replay this cascade's whole run in one call — pass state resets after every
        // executeBundles, so per-batch calls would pay one cache clear each. Emptied right
        // after the replay: a retained bundle pins every GPU resource it recorded, so the
        // scratch must not carry refs past the cascade.
        if (this._bundleRun.length > 0) {
          encoder.executeBundle(this._bundleRun);
          this._bundleRun.length = 0;
        }
      }

      // The light's cascades that needed rendering this frame are now drawn, so its layers belong
      // to the live map generation and its one-shot invalidation is satisfied.
      this._completeShadowUpdate(light);
    }

    pipeline.setColorMask(0b1111);

    // Shadow's cascade binds leave the live binding on the shadow map. Reset
    // activeTarget so the next default-target pass re-establishes the borrowed
    // surface — the invariant CopyOpaque follows.
    session.activeTarget = null;
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
