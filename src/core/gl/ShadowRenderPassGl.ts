import { BindGroup, UniformGroup, Texture } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';

import { stateFor3D } from '../../materials/BaseMaterial3D';
import { Matrix4 } from '../../math/matrix/Matrix4';
import type { ShadowData } from '../../scene/lights/Light';
import { resolveCullProducer } from '../cull';
import type { DepthHandle } from '../render-graph/ResourceHandle';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { RenderSession } from '../render-passes/RenderSession';
import { cascadeCountFor, castsShadowThisFrame } from '../render-passes/shadow/shadowPassUtils';
import { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import { instanceFetchBitGl } from '../shader/bits/instanceFetchBitGl';
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';
import { UINT_EMPTY } from '../textures/DefaultTextures';
import { shadowGlobalBitGl } from './shader/shadowGlobalBitGl';
import type { View3DPipeGl } from './View3DPipeGl';

/**
 * Constructor options for `ShadowRenderPassGl`
 * @internal
 */
interface ShadowRenderPassGlOptions {
  /** The owning WebGL renderer */
  renderer: WebGLRenderer;
  /** The graph's handle for the shadow-map array; `ShadowRenderPassBase#shadowMapHandle` describes it */
  shadowMapHandle: DepthHandle;
}

/**
 * The WebGL shadow-map vertex template
 *
 * Declares `normal` and `tangent` although depth needs neither, because the skinning and morph
 * bits write them.
 */
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
  bindGroups: ['global', 'camera'],
  gl: {
    vertex: shadowGlVertexTemplate,
    fragment: shadowGlFragmentTemplate,
  },
};

/**
 * Renders shadows for 3D scenes in WebGL, generating shadow maps from light perspectives
 *
 * Uses a cached DrawCommandList per batch: only rebuilds when that shadow
 * pass's draw version or instance count changes. On clean frames, redraws the cached commands.
 *
 * Draw state lives in each batch's DrawList, so View3D instances never share an index texture
 * or command list.
 *
 * The shadow shader's `global` group is the lighter `shadowGlobalBitGl`, so its descriptor turns
 * off the `globalBitGl` that `compileShader` would add, whose bindings would clash with it. The
 * camera group is the standard one and still comes from `compileShader`.
 * @internal
 */
export class ShadowRenderPassGl extends ShadowRenderPassBase<View3DPipeGl, ShadowData> {
  /**
   * Single batch-world uniform group reused for every shadow draw
   *
   * WebGL uploads uniforms per draw, so the render loop swaps the batch matrix between draws
   * rather than holding a group per light.
   */
  private readonly _shadowUniformGroup: UniformGroup;

  /**
   * Single bind group for every shadow draw, its slots in `shadowGlobalBitGl`'s order: 0 the
   * uniform group, 1 the bone pit, 2 the morph store, 3 the geometry data store, then
   * `instanceFetchBitGl`'s own textures, 4 the casting batch's mesh store and 5 this pass's
   * instance index. The cascade's matrices come from its camera group at group 1.
   */
  private readonly _shadowBindGroup: BindGroup;

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

    const uniformGroup = new UniformGroup({
      uBatchWorldMatrix: { value: new Matrix4(), type: 'mat4x4<f32>' },
    });
    uniformGroup.isStatic = true;
    uniformGroup.ubo = false;

    this._shadowUniformGroup = uniformGroup;
    this._shadowBindGroup = new BindGroup({
      0: uniformGroup,
      1: Texture.EMPTY.source,
      2: Texture.EMPTY.source,
      3: UINT_EMPTY.source,
      4: UINT_EMPTY.source,
      5: UINT_EMPTY.source,
    });
  }

  /** WebGL keeps the native [-1, 1] depth range, which `shadowBitGl` maps to [0, 1] when it samples */
  protected override readonly _applyZRangeFix = false;

  /**
   * Renders shadows in two sweeps, mirroring the WebGPU pass
   *
   * Sweep 1 rebuilds each batch's cached DrawCommandList on structural change (draw version or
   * count) and resolves its cull producer; `'off'` draws the full index, and `'cpu'` compacts in
   * the batcher's draw. It builds only while some light casts with a claimed shadow slot,
   * deliberately looser than `castsShadowThisFrame`: a hidden light still keeps its lists built,
   * since visibility doesn't dirty the pass and a list skipped while hidden would replay stale
   * when the light shows again. With no caster, nothing builds and the lists aren't marked
   * current, so a batch isn't stranded with an empty command list once a caster appears.
   *
   * Sweep 2 walks the casting lights. Each cascade that needs rendering this frame clears its own
   * layer of the shadow map, culls every batch against its own volume and draws into the layer; a
   * cascade the light's update rate skips keeps its layer and frozen matrix. GL runs each draw
   * immediately, so a cascade's compacted index is consumed before the next one overwrites it,
   * and the pass needs no per-light records as WebGPU does.
   *
   * The bone pit and the morph and geometry stores are bound once per frame, and the batch's world
   * matrix, mesh store and the pass's index texture per batch, which also picks up a texture that
   * growth replaced. The cascade's layer is bound, not pushed, so `session.activeTarget` is reset
   * afterwards and the next pass binds the default target again.
   * @param session - The frame's render session
   */
  public render(session: RenderSession): void {
    const { view3d, lights } = session;

    if (!lights.find((light) => light.canCastShadow)) return;

    this._bindShadowSource(view3d, this.renderTarget.depthStencilTexture!);

    this.pipe.renderer.colorMask.setMask(0);

    const bonePitSource = view3d._bonePit.texture.source;

    const batcher = this.pipe.renderer.material3d.batcher;

    const bindGroup = this._shadowBindGroup;
    const uniformGroup = this._shadowUniformGroup;
    bindGroup.setResource(bonePitSource, 1);
    bindGroup.setResource(this.pipe._morphStoreBuffer.texture.source, 2);
    bindGroup.setResource(this.pipe.geometryDataStoreBuffer.texture.source, 3);

    const hasCaster = lights.some((l) => l.castShadow && l._gpuShadowData && l._shadowDataIndex >= 0);

    for (const batch of view3d._meshBatches) {
      if (!batch.renderData._worldVisible) continue;
      const list = batch.drawLists[this.bit];
      if (!list) continue;

      const renderables = list.view;
      if (renderables.count === 0) continue;

      const needsRebuild = list.isDrawStale(renderables.count);

      if (hasCaster && needsRebuild) {
        list.claimDrawBuilt(renderables.count);
        renderables.sort();

        batcher.build({
          renderables,
          list: list,
          globalBindGroup: bindGroup,
          passBit: this.bit,
          skipTextureBatching: true,
        });
      }

      list._cullProducer = resolveCullProducer(batch.cull, false, renderables.count);
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

          uniformGroup.uniforms.uBatchWorldMatrix = batch.renderData.worldTransform;
          uniformGroup.update();

          bindGroup.setResource(batch.storeBuffer.texture.source, 4);
          if (list.glData.indexTexture) bindGroup.setResource(list.glData.indexTexture.texture.source, 5);

          batcher.draw(this.pipe.renderer, list, batch, frustum, slot.cameraData);
        }
      }

      this._completeShadowUpdate(light);
    }

    this.pipe.renderer.colorMask.setMask(0b1111);

    session.activeTarget = null;
  }

  /**
   * Drops the texture slots along with the shadow map: the textures they point at belong to the
   * View, the pipe and the batches, and the pipe frees its own when its renderer dies while this
   * View lives on
   */
  public override unload(): void {
    for (let i = 1; i <= 5; i++) {
      this._shadowBindGroup.setResource(i < 3 ? Texture.EMPTY.source : UINT_EMPTY.source, i);
    }
    super.unload();
  }

  /**
   * Releases the pass-owned shadow bind group
   *
   * `super.destroy()` frees the inherited shadow-map render target. pixi's `UniformGroup` has no
   * `destroy`, so `_shadowUniformGroup` is left to garbage collection, and the textures the bind
   * group points at belong to the View, the pipe and the batches.
   */
  public override destroy(): void {
    if (this._destroyed) return;

    this._shadowBindGroup.destroy();

    super.destroy();
  }
}
