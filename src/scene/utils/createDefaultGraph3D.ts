import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { ShadowRenderPassGl } from '../../core/gl/ShadowRenderPassGl';
import type { ShadowRenderPassGpu } from '../../core/gpu/ShadowRenderPassGpu';
import { RenderGraph } from '../../core/render-graph/RenderGraph';
import type { ColorHandle, DepthHandle } from '../../core/render-graph/ResourceHandle';
import { BackgroundPass } from '../../core/render-passes/background/BackgroundPass';
import { BlendedRefractionPass } from '../../core/render-passes/blended-refraction/BlendedRefractionPass';
import { CopyDepthPass } from '../../core/render-passes/copy-depth/CopyDepthPass';
import { CopyOpaquePass } from '../../core/render-passes/copy-opaque/CopyOpaquePass';
import { DepthClearPass } from '../../core/render-passes/depth-clear/DepthClearPass';
import { OpaqueRenderPass } from '../../core/render-passes/opaque/OpaqueRenderPass';
import { OutputPass } from '../../core/render-passes/output/OutputPass';
import type { RenderSession } from '../../core/render-passes/RenderSession';
import { TransmissionRenderPass } from '../../core/render-passes/transmission/TransmissionRenderPass';
import { TransparentRenderPass } from '../../core/render-passes/transparent/TransparentRenderPass';
import { PostEffect } from '../../post-processing/effects/PostEffect';
import type { Pass3D, PassContext } from '../../post-processing/Pass3D';

/**
 * Shared transient handles allocated by {@link createDefaultGraph3D}
 *
 * Returned alongside the graph so user passes layered on top of the defaults
 * can sample the same physical textures without re-allocating them.
 * @category rendering
 * @advanced
 */
export interface DefaultGraph3DHandles {
  /**
   * Mip-chained copy of the opaque colour buffer, produced by {@link CopyOpaquePass}
   * and consumed by {@link TransmissionRenderPass} / {@link BlendedRefractionPass}
   */
  opaqueColor: ColorHandle;
  /**
   * Copy of the opaque depth buffer, produced by {@link CopyDepthPass} and consumed
   * by {@link BlendedRefractionPass} and by effects that read depth
   */
  opaqueDepth: DepthHandle;
  /**
   * Cascaded shadow-map array texture, produced by `ShadowRenderPass`
   *
   * The pass owns the underlying `TextureSource` (lifecycle tied to quality
   * changes); the handle is the graph's tracking reference for the producer
   * edge. Imported (not transient) since the pass manages allocation.
   */
  shadowMap: DepthHandle;
}

/**
 * Options for {@link createDefaultGraph3D} — the same object a {@link View3D} hands its
 * custom `graph` builder, so a builder that starts from the default graph forwards it verbatim
 * @category rendering
 * @advanced
 */
export interface DefaultGraph3DOptions {
  /**
   * Render into a scene transient and blit to screen via `OutputPass` instead of
   * direct-to-screen
   *
   * Implied by any enabled post effect in `passes`; set it explicitly to alpha-composite an
   * inset over 2D without one.
   */
  composite?: boolean;
  /** The view's user passes; each contributes at its own stage, post effects in array order */
  passes?: readonly Pass3D[];
}

/**
 * Build the default 3D render graph for `renderer`'s backend
 *
 * This factory owns the orchestration directly — it imports the backend-agnostic
 * passes and instantiates them, asking the pipe only for the one backend-specific
 * pass (`createShadowPass` on the View3D pipe):
 *  - allocates the shared transient resources (opaque-colour + opaque-depth
 *    copies used by refractive material samplers),
 *  - instantiates each pass with `renderer` injected so `pass.pipe` is
 *    resolved at construction and `setup()` can run as soon as it's added,
 *  - threads shared handles into the constructors that need them (producer
 *    and consumer share one handle value, no reach-across),
 *  - adds each pass to the graph in the order it must execute, calling each
 *    user {@link Pass3D} at its stage along the way.
 *
 * User passes layered on top via a `new View3D({ graph: (renderer, options) => ... })`
 * callback can sample the returned {@link DefaultGraph3DHandles} shared
 * transients without reallocating them. The flat pass list is available via
 * `graph.passes`.
 *
 * Mirrors Frostbite's FrameGraph orchestration shape: handles are owned by
 * the orchestrator and threaded into producer + consumer at construction,
 * so neither pass has to reach across to the other to find them.
 * @param renderer - renderer whose backend selects the pass implementations.
 * @param options - composite mode and the user pass list; see {@link DefaultGraph3DOptions}.
 * @returns The compiled graph and its {@link DefaultGraph3DHandles} shared transients.
 * @category rendering
 * @advanced
 */
export function createDefaultGraph3D(
  renderer: WebGLRenderer | WebGPURenderer,
  options: DefaultGraph3DOptions = {},
): {
  /** The compiled render graph, ready to execute */
  graph: RenderGraph;
  /** Shared transient handles threaded through the graph's passes */
  handles: DefaultGraph3DHandles;
} {
  // The enabled slice of the user passes, split by stage. The post stage is the
  // fullscreen chain and belongs to PostEffect: it owns the input/output
  // contract, so anything else claiming it is an authoring error, not a no-op.
  const enabled = options.passes?.filter((p) => p.enabled) ?? [];
  const beforeOpaque = enabled.filter((p) => p.stage === 'beforeOpaque');
  const afterOpaque = enabled.filter((p) => p.stage === 'afterOpaque');
  const afterTransparent = enabled.filter((p) => p.stage === 'afterTransparent');
  const effects: PostEffect[] = [];
  for (const pass of enabled) {
    if (pass.stage !== 'post') continue;
    if (!(pass instanceof PostEffect)) {
      throw new Error(
        `${pass.constructor.name}: the 'post' stage is reserved for PostEffect subclasses (extend PostEffect, or use a scene stage).`,
      );
    }
    effects.push(pass);
  }

  // Any post effect implies composite: effects sample the scene as a texture,
  // so it must render into a transient; an empty chain keeps the
  // direct-to-screen fast path unless `composite` was explicitly requested
  // (the inset-over-2D case).
  const composite = (options.composite ?? false) || effects.length > 0;
  // The first effect's input is sceneColor itself — when it samples LODs the
  // scene renders straight into a mip-chained transient (later effects' inputs
  // are ping-pong transients, provisioned in the chain walk below).
  const sceneColorMips = effects[0]?.inputMips === true;
  const pipe = renderer.renderPipes.view3d;

  const graph = new RenderGraph({
    // `colorTexture` is already a Texture; `depthStencilTexture` is a Source —
    // both satisfy `BindableTexture` (TextureSource self-references via `.source`).
    defaultColor: (s: RenderSession) => s.defaultTarget.colorTexture,
    defaultDepth: (s: RenderSession) => s.defaultTarget.depthStencilTexture!,
    // Composite: the scene accumulates into a View-sized colour+depth transient,
    // then OutputPass blits it to the screen. Omitted in direct mode → scene draws
    // straight to screen. The graph renders every transient into its [0, vp] content
    // region (pooled textures round up to a power of two), the same sub-rect the
    // opaque copies use; glass refraction (via pipe.copyColor) and OutputPass both
    // map back through uViewportUVScale.
    sceneColor: composite ? { autoGenerateMipmaps: sceneColorMips, label: 'sceneColor' } : undefined,
    sceneDepth: composite ? { label: 'sceneDepth' } : undefined,
  });

  // The opaque copies are viewport-sized transients: the shared pool rounds them up to a
  // power-of-two bucket, or caps them at the canvas, so the viewport content occupies a sub-rect
  // [0, vp/tex] of the pooled texture and transmission/refraction map their viewport-relative UV
  // onto it via the camera group's uViewportUVScale lane. Bucketing lets many different-sized views
  // share one texture. Depth-aware refraction indexes the depth copy with the same UV; scaled-UV ×
  // full-texture dims cancels to the content extent.
  const opaqueColorHandle = graph.createColor({ autoGenerateMipmaps: true, label: 'opaqueColorCopy' });
  const opaqueDepthHandle = graph.createDepth({ label: 'opaqueDepthCopy' });

  // What every user pass gets at build time; the post chain extends it per slot.
  const ctx: PassContext = { renderer, opaqueColor: opaqueColorHandle, opaqueDepth: opaqueDepthHandle };

  // Closure-capture for the shadow map: the pass owns the TextureSource
  // (lazy-allocated inside the pass on first access), but `importDepth` needs
  // a stable getter to resolve the live texture every frame. Forward-declare
  // the pass, register the handle (the function only runs at execute time),
  // then construct.
  let shadowPass: ShadowRenderPassGpu | ShadowRenderPassGl;
  const shadowMapHandle = graph.importDepth(() => shadowPass.renderTarget.depthStencilTexture!);

  shadowPass = pipe.createShadowPass({ shadowMapHandle });
  graph.addPass(shadowPass);

  // Stage 'beforeOpaque': shadows are up, nothing else in the frame has been drawn. A pass
  // that fills a texture the scene then samples — a camera feed, a mirror — belongs here, so
  // the image is complete before any scene material reaches for it.
  for (const pass of beforeOpaque) pass.build(graph, ctx);

  // A View3D shares one depth buffer with the surrounding 2D and every other
  // View3D threaded into the same target, so depth must be reset per-view
  // before Opaque. Both backends ship a pass for this, by different means:
  //  - WebGPU: a fullscreen-triangle far-depth draw (the live pass is frozen
  //    at beginRenderPass, so a mid-pass loadOp clear isn't available). It also
  //    covers Pixi's 2D state writing depth on WebGPU (depthMask on even with
  //    depth-test off), which an opaque 2D element in front of an inset would
  //    otherwise use to occlude it.
  //  - WebGL: a native `gl.clear(DEPTH)` (View3DPipeGl.clearDepth). WebGL suppresses
  //    depth writes while depth-test is off, so it never hits the 2D case;
  //    this pass exists purely for overlapping-inset isolation.
  graph.addPass(new DepthClearPass({ renderer }));
  graph.addPass(new BackgroundPass({ renderer }));
  graph.addPass(new OpaqueRenderPass({ renderer }));

  // Stage 'afterOpaque': part of the opaque world, so the copies below carry it
  // and glass refracts it.
  for (const pass of afterOpaque) pass.build(graph, ctx);

  graph.addPass(new CopyDepthPass({ renderer, opaqueDepthHandle }));
  // The copy is allocated mip-chained, so the graph generates its mipmaps right after the copy
  // writes mip 0, before any transmissive pass samples a blurred LOD.
  graph.addPass(new CopyOpaquePass({ renderer, opaqueColorHandle }));

  // Standard glTF transmissive materials sample opaque colour only; opaque depth
  // is BlendedRefraction's concern, so Transmission doesn't anchor the depth
  // handle and pure-transmissive scenes skip CopyDepth.
  graph.addPass(new TransmissionRenderPass({ renderer, opaqueColorHandle }));
  graph.addPass(new BlendedRefractionPass({ renderer, opaqueColorHandle, opaqueDepthHandle }));
  graph.addPass(new TransparentRenderPass({ renderer }));

  // Stage 'afterTransparent': the last scene draws before the chain.
  for (const pass of afterTransparent) pass.build(graph, ctx);

  // --- The post chain ---
  // Each effect's build() adds its passes, reading the chain image entering
  // its slot and writing the next one; intermediates ping-pong through pooled
  // viewport transients, and the LAST effect is elected presenter
  // (output = null → its final pass writes the View's default target
  // directly, replacing the OutputPass blit). Scene resources beyond the
  // chain — sceneDepth, new transients — come off the graph inside build().
  // OutputPass survives only as the empty-chain presenter for explicit
  // composite mode.
  if (effects.length > 0) {
    let current = graph.sceneColor;
    for (let i = 0; i < effects.length; i++) {
      // `inputMips` provisioning: this slot's input was allocated mip-chained
      // (sceneColor above for slot 0, the previous slot's output below), and the
      // graph generates a mip-chained colour's mipmaps after its last writer, so the
      // effect needs no copy of its input.
      const output =
        i === effects.length - 1
          ? null
          : graph.createColor({ autoGenerateMipmaps: effects[i + 1].inputMips, label: 'effectChain' });
      effects[i].build(graph, { ...ctx, input: current, output });
      if (output) current = output;
    }
  } else if (composite) {
    // Bare composite (no enabled effects): blit the scene transient onto the
    // screen. Writes the default colour+depth → resolves to the screen target,
    // so the executor binds the View's on-canvas rect.
    graph.addPass(new OutputPass({ renderer, source: graph.sceneColor }));
  }

  // Build the dependency DAG + run hazard validation once now, rather than
  // deferring to first execute(). Catches authoring mistakes at construction
  // time, and the per-pass `dependsOn` / `isAnchored` state is ready for
  // `resolve()`'s refcount cull on the very first frame.
  graph.compile();

  return {
    graph,
    handles: {
      opaqueColor: opaqueColorHandle,
      opaqueDepth: opaqueDepthHandle,
      shadowMap: shadowMapHandle,
    },
  };
}
