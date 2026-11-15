import type { WebGLRenderer } from 'pixi.js';

import { stateFor3D } from '../../materials/BaseMaterial3D';
import type { ShadowData } from '../../scene/lights/Light';
import type { DepthHandle } from '../render-graph/ResourceHandle';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { RenderSession } from '../render-passes/RenderSession';
import { cascadeCountFor, castsShadowThisFrame } from '../render-passes/shadow/shadowPassUtils';
import { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import { UINT_EMPTY } from '../textures/DefaultTextures';
import type { View3DPipeGl } from './View3DPipeGl';

interface ShadowRenderPassGlOptions {
  renderer: WebGLRenderer;
  shadowMapHandle: DepthHandle;
}

/**
 * Renders shadows for 3D scenes in WebGL, generating shadow maps from light perspectives
 *
 * Uses a cached DrawCommandList per batch, and `DrawList.nextBuild` decides when it rebuilds. On
 * clean frames, redraws the cached commands.
 *
 * Draw state lives in each batch's DrawList, so View3D instances never share an index texture
 * or command list.
 *
 * The shadow shader gets `globalBitGl` and the camera bit from `compileShader`, like every mesh
 * pass, so a shader drawn here can read any global uniform. It declares `uShadowMap` too, but the
 * GLSL compiler drops a sampler the program never reads, and pixi binds a texture only for an
 * active uniform, so the live map is never bound for sampling while the pass renders into it.
 * @internal
 */
export class ShadowRenderPassGl extends ShadowRenderPassBase<View3DPipeGl, ShadowData> {
  constructor(options: ShadowRenderPassGlOptions) {
    const shadowState = stateFor3D();
    shadowState.depthTest = true;
    shadowState.culling = true;
    shadowState.clockwiseFrontFace = true;
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

  /** WebGL keeps the native [-1, 1] depth range, which `shadowBitsGl` maps to [0, 1] when it samples */
  protected override readonly _applyZRangeFix = false;

  /**
   * Builds lists while any light casts with a claimed slot, hidden or not, and skips `nextBuild` with none, so no list
   * goes stale or is marked built while empty. Layers are bound, not pushed, so `session.activeTarget` is reset.
   */
  public render(session: RenderSession): void {
    const { view3d, lights } = session;

    if (!lights.find((light) => light.canCastShadow)) return;

    this._bindShadowSource(view3d, this.renderTarget.depthStencilTexture!);

    this.pipe.renderer.colorMask.setMask(0);

    const batcher = this.pipe.renderer.material3d.batcher;

    const bindGroup = session.globalBindGroup;

    const hasCaster = lights.some((l) => l.castShadow && l._gpuShadowData && l._shadowDataIndex >= 0);

    for (const batch of view3d._meshBatches) {
      if (!batch.renderData._worldVisible) continue;
      const list = batch.drawLists[this.bit];
      if (!list) continue;

      const renderables = list.view;
      if (renderables.count === 0 || !hasCaster) continue;

      if (list.nextBuild(view3d._updateTick)) {
        list.claimDrawBuilt();

        batcher.build({
          renderables,
          list: list,
          globalBindGroup: bindGroup,
          passBit: this.bit,
        });
      }
    }

    for (const light of lights) {
      if (!castsShadowThisFrame(light)) continue;

      const cascadeCount = cascadeCountFor(light);

      for (let c = 0; c < cascadeCount; c++) {
        const slot = this._cascadeSlot(light, c);
        if (!slot.needsRender) continue;

        const frustum = slot.cameraData.frustum;

        this.pipe.renderer.renderTarget.bind({
          target: this.renderTarget,
          clear: true,
          layer: light._shadowDataIndex + c,
        });

        for (const batch of view3d._meshBatches) {
          if (!batch.renderData._worldVisible) continue;
          const list = batch.drawLists[this.bit];
          if (!list || list.view.count === 0) continue;

          bindGroup.setResource(batch.storeBuffer.texture.source, 'uMeshStoreTexture');
          if (list.glData.indexTexture) {
            bindGroup.setResource(list.glData.indexTexture.texture.source, 'uRenderInstanceTexture');
          }
          bindGroup.setResource(
            batch.instanceStoreBuffer?.texture.source ?? UINT_EMPTY.source,
            'uInstanceStoreTexture',
          );

          batcher.draw(this.pipe.renderer, list, batch, frustum, slot.cameraData);
        }
      }

      this._completeShadowUpdate(light);
    }

    this.pipe.renderer.colorMask.setMask(0b1111);

    session.activeTarget = null;
  }
}
