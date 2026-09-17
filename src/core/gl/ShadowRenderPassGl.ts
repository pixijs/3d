import { BindGroup, UniformGroup, Texture } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';

import { stateFor3D } from '../../materials/BaseMaterial3D';
import { Matrix4 } from '../../math/matrix/Matrix4';
import type { ShadowData } from '../../scene/lights/Light';
import type { View3D } from '../../scene/View3D';
import { resolveCullProducer } from '../cull';
import type { DepthHandle } from '../render-graph/ResourceHandle';
import { RenderPassBit } from '../render-passes/RenderPass';
import type { RenderSession } from '../render-passes/RenderSession';
import { cascadeCountFor, castsShadowThisFrame, writeCascadeSlot } from '../render-passes/shadow/shadowPassUtils';
import type { CascadeSlot } from '../render-passes/shadow/shadowPassUtils';
import { ShadowRenderPassBase } from '../render-passes/shadow/ShadowRenderPassBase';
import { instanceFetchBitGl } from '../shader/bits/instanceFetchBitGl';
import type { ShaderBitTemplate } from '../shader/ShaderBitTemplate';
import { getGlobalGlData } from './shader/globalBitGl';
import { shadowGlobalBitGl } from './shader/shadowGlobalBitGl';
import type { View3DPipeGl } from './View3DPipeGl';

/**
 * Constructor options for `ShadowRenderPassGl`
 * @internal
 */
interface ShadowRenderPassGlOptions {
  /** The owning WebGL renderer */
  renderer: WebGLRenderer;
  /**
   * Graph-imported handle for the shadow-map array texture
   *
   * The pass owns the underlying `TextureSource` (lazy-allocated via `this.renderTarget`,
   * reallocated on quality changes); the handle is the graph's tracking reference, registered in
   * `createDefaultGraph3D` via `graph.importDepth(() => pass.renderTarget.depthStencilTexture)`.
   */
  shadowMapHandle: DepthHandle;
}

const shadowGlVertexTemplate = `#version 300 es
precision highp float;
precision highp sampler2D;

{{header}}

void main() {
  mat4 modelMatrix;

  // Mutable locals -- skinning bit modifies these before world transform
  vec4 position;
  vec3 normal = vec3(0.0);   // dummy, required by skinning bit
  vec3 tangent = vec3(0.0);  // dummy, required by skinning bit

  {{input}}

  vec4 worldPosition = modelMatrix * position;
  gl_Position = uViewProjectionMatrix * worldPosition;

  {{end}}
}`;

const shadowGlFragmentTemplate = `#version 300 es
precision highp float;
precision highp sampler2D;
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
 * pass's draw version changes. On clean frames, redraws the cached commands.
 *
 * State is cached in DrawList so multiple View3D instances don't corrupt
 * each other's persistent buffers or command lists.
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

  /** Single bind group wrapping `_shadowUniformGroup` (slot 0) + the bone-pit texture (slot 1) */
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
          // Supplies its own lighter `global` group; the full globalBitGl would
          // collide with it (mismatched bindings → crash). The camera group is
          // the standard one, so it still comes from the compiler.
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
    // Slots: 0 uniforms, 1 bone-pit, 2 morph store, 3 geometry facts (shadow-morph),
    // 4 the casting batch's mesh store, 5 this pass's instance index. The last two
    // are `instanceFetchBitGl`'s own bindings, so they follow the shadow globals.
    // The cascade's matrices are not here — they come from its camera group at group 1.
    this._shadowBindGroup = new BindGroup({
      0: uniformGroup,
      1: Texture.EMPTY.source,
      2: Texture.EMPTY.source,
      3: Texture.EMPTY.source,
      4: Texture.EMPTY.source,
      5: Texture.EMPTY.source,
    });
  }

  /** WebGL keeps makeOrthographic's native [-1,1] depth range */
  protected override readonly _applyZRangeFix = false;

  /**
   * Packs the slot into the `uShadowData` uniform (24-float stride) the forward shader samples
   * @param slot - The populated cascade slot
   * @param slotIndex - Entry index in `uShadowData`, in 24-float strides
   * @param view3d - The view whose global uniforms receive the slot
   */
  protected override _uploadSlot(slot: CascadeSlot, slotIndex: number, view3d: View3D): void {
    const uShadowData = getGlobalGlData(view3d, this.pipe.renderer).globalUniformGroup.uniforms
      .uShadowData as unknown as Float32Array;
    writeCascadeSlot(slot, uShadowData, slotIndex * 24);
  }

  /**
   * Renders shadows in two sweeps, mirroring the WebGPU pass
   *
   * Sweep 1 rebuilds each batch's cached DrawCommandList on structural change (draw version /
   * count) and resolves its cull producer; sweep 2 walks the casting lights — each rendering
   * cascade culls every batch against its own volume and draws into its layer, compacting
   * survivors inside the draw's upload. Per-view survivor sets need no persistent state here: GL
   * executes immediately, so each upload is consumed before the next view overwrites it.
   * @param session - The frame's render session
   */
  public render(session: RenderSession): void {
    const { view3d, lights } = session;

    if (!lights.find((light) => light.castShadow)) return;

    this._bindShadowSource(view3d, this.renderTarget.depthStencilTexture!);

    this.pipe.renderer.colorMask.setMask(0);

    const bonePitSource = view3d._bonePit.texture.source;

    const batcher = this.pipe.renderer.material3d.batcher;

    // Single shared bind group + uniform group for every shadow draw — WebGL uploads uniforms
    // per draw, so we swap the batch matrix between draws instead of holding a group per light.
    // The cascade's own matrices come from its camera group at group 1. The bone-pit only needs
    // (re)binding once per frame.
    const bindGroup = this._shadowBindGroup;
    const uniformGroup = this._shadowUniformGroup;
    bindGroup.setResource(bonePitSource, 1);
    // Shadow-morph data textures, re-bound each frame so a store reallocation from
    // arena growth is captured (same as the forward pipe re-binds slots 8–9).
    bindGroup.setResource(this.pipe._morphStoreBuffer.texture.source, 2);
    bindGroup.setResource(this.pipe.geometryDataStoreBuffer.texture.source, 3);

    const cullOn = view3d.cull !== 'off';

    // Deliberately looser than `castsShadowThisFrame`: no `worldVisible`, so a hidden light still
    // keeps the command list built. Gating the build on a per-frame visibility flag would leave a
    // stale list to replay when the light reshows (visibility doesn't dirty the pass).
    const hasCaster = lights.some((l) => l.castShadow && l._gpuShadowData && l._shadowDataIndex >= 0);

    // Sweep 1 — per batch, light-independent: rebuild the command list on structural change and
    // resolve the cull producer (WebGL has no compute → 'gpu' degrades to 'cpu'; 'auto' still gates
    // by count). 'off' keeps the full upload; the batcher's draw compacts for 'cpu'.
    for (const batch of view3d._meshBatches) {
      if (!batch.renderData._worldVisible) continue;
      const list = batch.drawLists[this.bit];
      if (!list) continue;

      const renderables = list.view;
      if (renderables.count === 0) continue;

      const needsRebuild = list.isDrawStale(renderables.count);

      // The watermarks are only claimed alongside an actual build: with no caster
      // there is nothing to build, and marking the cache current would strand this batch with an
      // empty command list once a caster appears.
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

      list._cullProducer = cullOn ? resolveCullProducer(view3d.cull, false, renderables.count) : 'off';
    }

    // Sweep 2 — per casting light: cull every batch against each rendering cascade's own volume and
    // draw into its layer. Immediate mode is what keeps this stateless (no WebGPU-style per-light
    // records): the compacting upload runs inside each draw, right before the GL calls that consume
    // it, so one cascade's survivors never need to outlive its own draws.
    for (const light of lights) {
      if (!castsShadowThisFrame(light)) continue;

      const cascadeCount = cascadeCountFor(light);

      for (let c = 0; c < cascadeCount; c++) {
        const slot = this._cascadeSlot(light, c);
        // A temporal update rate / manual mode skipped this cascade this frame —
        // its existing layer and frozen matrix stay valid (and it culls nothing).
        if (!slot.needsRender) continue;

        const frustum = cullOn ? slot.cameraData.frustum : null;

        // bind (not push) the cascade's shadow-map layer: the graph re-establishes the default
        // target after this self-managing pass. One bind + clear per layer, then every batch
        // draws into it.
        this.pipe.renderer.renderTarget.bind({
          target: this.renderTarget,
          clear: true,
          layer: light._shadowDataIndex + c,
        });

        for (const batch of view3d._meshBatches) {
          if (!batch.renderData._worldVisible) continue;
          const list = batch.drawLists[this.bit];
          if (!list || list.view.count === 0) continue;

          // The shared uniform group re-uploads per draw — uBatchWorldMatrix varies per batch.
          uniformGroup.uniforms.uBatchWorldMatrix = batch.renderData.worldTransform;
          uniformGroup.update();

          // Each batch owns its mesh store and each pass its index list, so both are
          // re-bound per batch. Re-reading `.texture.source` also picks up a source
          // swapped out by store growth.
          bindGroup.setResource(batch.storeBuffer.texture.source, 4);
          if (list.glData.indexTexture) bindGroup.setResource(list.glData.indexTexture.texture.source, 5);

          batcher.draw(this.pipe.renderer, list, batch, frustum, slot.cameraData);
        }
      }

      // The light's cascades that needed rendering this frame are now drawn, so its layers belong
      // to the live map generation and its one-shot invalidation is satisfied.
      this._completeShadowUpdate(light);
    }

    this.pipe.renderer.colorMask.setMask(0b1111);

    // Shadow's per-light binds leave the live binding on the shadow map. Reset
    // activeTarget so the next default-target pass re-establishes the borrowed
    // surface — the invariant CopyOpaque follows.
    session.activeTarget = null;
  }

  /**
   * Releases the single pass-owned shadow bind group (the shared batch-world uniform group in
   * slot 0 + the bone-pit texture in slot 1)
   *
   * `super.destroy()` frees the inherited shadow-map render target. The wrapped
   * `_shadowUniformGroup` is renderer-managed (UniformGroups are never destroyed), and the
   * bone-pit source is owned by View3D.
   */
  public override destroy(): void {
    if (this._destroyed) return;

    this._shadowBindGroup.destroy();

    super.destroy();
  }
}
