import type { WebGLRenderer } from 'pixi.js';

import { stateFor3D } from '../../materials/BaseMaterial3D';
import type { ShadowData } from '../../scene/lights/Light';
import type { DepthHandle } from '../render-graph/ResourceHandle';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { RenderSession } from '../render-passes/RenderSession';
import { cascadeCountFor, castsShadowThisFrame } from '../render-passes/shadow/shadowPassUtils';
import { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import { instanceFetchBitGl } from '../shader/bits/instanceFetchBitGl';
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';
import { shadowGlobalBitGl } from './shader/shadowGlobalBitGl';
import type { View3DPipeGl } from './View3DPipeGl';

interface ShadowRenderPassGlOptions {
  renderer: WebGLRenderer;
  shadowMapHandle: DepthHandle;
}

/** Declares `normal` and `tangent`, which depth doesn't need, because the skinning and morph bits write them */
const shadowGlVertexTemplate = `#version 300 es

{{header}}

void main() {
  mat4 modelMatrix;

  vec4 position;
  vec3 normal = vec3(0.0);
  vec3 tangent = vec3(0.0);

  {{input}}

  vec4 worldPosition = modelMatrix * position;
  gl_Position = uViewProjectionMatrix * worldPosition;

  {{end}}
}`;

const shadowGlFragmentTemplate = `#version 300 es
out vec4 fragColor;

{{header}}

void main() {
    fragColor = vec4(0.);
}`;

const shadowTemplateGl: ShaderBitTemplate = {
  bindGroups: [{ name: 'global', ubo: true }, 'camera'],
  gl: {
    vertex: shadowGlVertexTemplate,
    fragment: shadowGlFragmentTemplate,
  },
};

/**
 * The descriptor turns off the `globalBitGl` that `compileShader` adds, whose bindings would clash with
 * `shadowGlobalBitGl`
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
      descriptor: {
        shaderDescriptor: {
          bitsGl: [shadowGlobalBitGl, instanceFetchBitGl],
          template: shadowTemplateGl,
          includeGlobal: false,
        },
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
          bindsMaterial: false,
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

          batcher.draw(this.pipe.renderer, list, batch, frustum, slot.cameraData);
        }
      }

      this._completeShadowUpdate(light);
    }

    this.pipe.renderer.colorMask.setMask(0b1111);

    session.activeTarget = null;
  }
}
