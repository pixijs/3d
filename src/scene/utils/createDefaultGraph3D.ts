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
 * Handles to the textures {@link createDefaultGraph3D} shares between its passes
 *
 * Returned with the graph, so passes added on top of the defaults can sample the same textures
 * instead of copying the scene again.
 *
 * The opaque copies are pooled textures that can be larger than the view, so many views of
 * different sizes can share one. The view's content fills a sub-rect starting at the texture's
 * origin, and a shader maps view UV onto it through the camera's `uViewportUVScale`. A depth
 * lookup at the same UV lands on the matching texel.
 * @category rendering
 * @advanced
 */
export interface DefaultGraph3DHandles {
  /**
   * Copy of the opaque scene's colour, taken by {@link CopyOpaquePass} and read by
   * {@link TransmissionRenderPass} and {@link BlendedRefractionPass}
   *
   * It has mipmaps, generated right after the copy, before any transmissive pass samples a
   * blurred level.
   */
  opaqueColor: ColorHandle;
  /**
   * Copy of the opaque scene's depth, taken by {@link CopyDepthPass} and read by
   * {@link BlendedRefractionPass} and by effects that read depth
   *
   * {@link TransmissionRenderPass} doesn't read it, so a scene whose only see-through materials
   * are transmissive skips the copy.
   */
  opaqueDepth: DepthHandle;
  /**
   * The shadow pass's shadow-map array, one layer per light or cascade
   *
   * The pass owns the texture and reallocates it when the shadow quality changes, so the graph
   * imports it rather than allocating it.
   */
  shadowMap: DepthHandle;
}

/**
 * Options for {@link createDefaultGraph3D}: the same object a {@link View3D} hands its
 * custom `graph` builder, so a builder that starts from the default graph forwards it verbatim
 * @category rendering
 * @advanced
 */
export interface DefaultGraph3DOptions {
  /**
   * Draw the scene into its own texture, then onto the screen, instead of straight to the screen
   *
   * Any enabled post effect in `passes` turns it on, because effects sample the scene as a
   * texture. Set it yourself to alpha-composite an inset over 2D content without an effect.
   */
  composite?: boolean;
  /** The view's user passes; each contributes at its own stage, post effects in array order */
  passes?: readonly Pass3D[];
}

/**
 * Builds the render graph a {@link View3D} uses unless its `graph` option supplies one
 *
 * Start from it in a custom `graph` builder to add passes the {@link Pass3D} stages can't
 * express. The passes run in this order, with each user pass built at its {@link PassStage}:
 *
 * 1. The shadow pass, the one pass that differs by backend.
 * 2. `'beforeOpaque'` user passes.
 * 3. A depth reset over the view's rect, then the background and the opaque scene. A view shares
 *    its depth buffer with the 2D scene around it and with other views drawn to the same
 *    target, so it resets depth before it draws.
 * 4. `'afterOpaque'` user passes.
 * 5. Copies of the opaque depth and colour, then the transmissive, blended-refraction and
 *    transparent scene.
 * 6. `'afterTransparent'` user passes.
 * 7. The post effects, in array order.
 *
 * In composite mode the scene draws into a view-sized colour and depth texture. Each post effect
 * reads the image the one before it wrote, through pooled textures, and the last effect draws
 * straight to the screen. Composite mode with no effects ends with an output pass that draws
 * the scene texture to the screen. An effect whose `inputMips` is set gets an input with
 * mipmaps, generated after that input's last writer, so the effect needs no copy of it.
 *
 * Passes that share a texture are handed the same handle when they are created, so neither has
 * to find the other. The graph comes back compiled, so authoring mistakes throw here rather than
 * on the first frame. `graph.passes` lists every pass.
 * @example
 * ```ts
 * new View3D({
 *   graph: (renderer, options) => {
 *     const { graph, handles } = createDefaultGraph3D(renderer, options);
 *     graph.addPass(new MyHeatHazePass({ renderer, opaqueColorHandle: handles.opaqueColor }));
 *     return graph;
 *   },
 * });
 * ```
 * @param renderer - renderer whose backend selects the pass implementations.
 * @param options - composite mode and the user pass list; see {@link DefaultGraph3DOptions}.
 * @returns The compiled graph and its {@link DefaultGraph3DHandles} shared transients.
 * @throws If a pass that isn't a {@link PostEffect} claims the `'post'` stage, which is reserved
 *   for effects because each one owns its input and output in the chain.
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

  const composite = (options.composite ?? false) || effects.length > 0;
  const sceneColorMips = effects[0]?.inputMips === true;

  const graph = new RenderGraph({
    defaultColor: (s: RenderSession) => s.defaultTarget.colorTexture,
    defaultDepth: (s: RenderSession) => s.defaultTarget.depthStencilTexture!,
    sceneColor: composite ? { autoGenerateMipmaps: sceneColorMips, label: 'sceneColor' } : undefined,
    sceneDepth: composite ? { label: 'sceneDepth' } : undefined,
  });

  const opaqueColorHandle = graph.createColor({ autoGenerateMipmaps: true, label: 'opaqueColorCopy' });
  const opaqueDepthHandle = graph.createDepth({ label: 'opaqueDepthCopy' });

  const ctx: PassContext = { renderer, opaqueColor: opaqueColorHandle, opaqueDepth: opaqueDepthHandle };

  const shadowMapHandle = addShadowPass(graph, renderer);

  for (const pass of beforeOpaque) pass.build(graph, ctx);

  graph.addPass(new DepthClearPass({ renderer }));
  graph.addPass(new BackgroundPass({ renderer }));
  graph.addPass(new OpaqueRenderPass({ renderer }));

  for (const pass of afterOpaque) pass.build(graph, ctx);

  graph.addPass(new CopyDepthPass({ renderer, opaqueDepthHandle }));
  graph.addPass(new CopyOpaquePass({ renderer, opaqueColorHandle }));

  graph.addPass(new TransmissionRenderPass({ renderer, opaqueColorHandle }));
  graph.addPass(new BlendedRefractionPass({ renderer, opaqueColorHandle, opaqueDepthHandle }));
  graph.addPass(new TransparentRenderPass({ renderer }));

  for (const pass of afterTransparent) pass.build(graph, ctx);

  if (effects.length > 0) {
    let current = graph.sceneColor;
    for (let i = 0; i < effects.length; i++) {
      const output =
        i === effects.length - 1
          ? null
          : graph.createColor({ autoGenerateMipmaps: effects[i + 1].inputMips, label: 'effectChain' });
      effects[i].build(graph, { ...ctx, input: current, output });
      if (output) current = output;
    }
  } else if (composite) {
    graph.addPass(new OutputPass({ renderer, source: graph.sceneColor }));
  }

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

/**
 * Adds the backend's shadow pass and returns the handle the graph tracks its shadow map by
 *
 * The pass creates its shadow map on first use and replaces it when the shadow quality changes,
 * so the graph imports it through a getter that reads the pass's live target each frame. The pass
 * takes the handle in its constructor, so the getter is registered before the pass exists; it
 * only runs at execute time.
 * @param graph - Graph to add the pass to
 * @param renderer - Renderer whose View3D pipe creates the backend's shadow pass
 */
function addShadowPass(graph: RenderGraph, renderer: WebGLRenderer | WebGPURenderer): DepthHandle {
  let shadowPass: ShadowRenderPassGpu | ShadowRenderPassGl;
  const shadowMapHandle = graph.importDepth(() => shadowPass.renderTarget.depthStencilTexture!);

  shadowPass = renderer.renderPipes.view3d.createShadowPass({ shadowMapHandle });
  graph.addPass(shadowPass);

  return shadowMapHandle;
}
