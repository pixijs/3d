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
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';
import { produceCpuCompaction, produceVisibilityCompaction } from './cull';
import { shadowGlobalBitGpu } from './shader/shadowGlobalBitGpu';
import type { View3DPipeGpu } from './View3DPipeGpu';

interface ShadowRenderPassGpuOptions {
  renderer: WebGPURenderer;
  shadowMapHandle: DepthHandle;
}

/** Declares `normal` and `tangent` with the material template's types, for the morph and skinning bits to write */
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
  bindGroups: [{ name: 'global', ubo: true }, 'camera', 'local'],
  gpu: shadowGpuTemplate,
};

/** @internal */
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
          bindsMaterial: false,
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
   * Binds each layer rather than pushing it, and resets `activeTarget`, as the next pass binds its own;
   * cascade camera buffers opt out of pixi's GC, which can't see bundles use them, and
   * `releaseShadowCascades` frees them
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

          if (result.direct && batch.cull !== 'off') {
            result.bundle = null;
            session.globalBindGroup.setResource(batch.storeBuffer.bufferResource, 'uRenderableStorage');
            session.globalBindGroup.setResource(result.survivors.bufferResource, 'uRenderableInstanceStorage');
            list.commandList.replayDirect(encoder, result.indirectDrawData, cascade.cameraData);
            continue;
          }

          const recorded = result.bundle;

          if (!recorded || result.isBundleStale(list, cameraBindGroup) || !encoder.isBundleValid(recorded)) {
            const { globalBindGroup } = session;

            globalBindGroup.setResource(batch.storeBuffer.bufferResource, 'uRenderableStorage');
            globalBindGroup.setResource(result.survivors.bufferResource, 'uRenderableInstanceStorage');

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
            session.globalBindGroup.setResource(batch.storeBuffer.bufferResource, 'uRenderableStorage');
            session.globalBindGroup.setResource(result.survivors.bufferResource, 'uRenderableInstanceStorage');
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

    session.activeTarget = null;
  }
}
