import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { ShadowRenderPassGl } from '../../core/gl/ShadowRenderPassGl';
import type { ShadowRenderPassGpu } from '../../core/gpu/ShadowRenderPassGpu';
import { RenderGraph } from '../../core/render-graph/RenderGraph';
import type { ColorHandle, DepthHandle } from '../../core/render-graph/ResourceHandle';
import type { SceneOutput } from '../../core/render-graph/SceneOutput';
import { collectSceneOutputs } from '../../core/render-graph/sceneOutputs';
import type { GlobalTextureBindings } from '../../core/render-graph/TextureBinding';
import { BackgroundPass } from '../../core/render-passes/background/BackgroundPass';
import { BlendedRefractionPass } from '../../core/render-passes/blended-refraction/BlendedRefractionPass';
import { CopyDepthPass } from '../../core/render-passes/copy-depth/CopyDepthPass';
import { CopyOpaquePass } from '../../core/render-passes/copy-opaque/CopyOpaquePass';
import { DepthClearPass } from '../../core/render-passes/depth-clear/DepthClearPass';
import { OpaqueRenderPass } from '../../core/render-passes/opaque/OpaqueRenderPass';
import type { RenderSession } from '../../core/render-passes/RenderSession';
import { TransmissionRenderPass } from '../../core/render-passes/transmission/TransmissionRenderPass';
import { TransparentRenderPass } from '../../core/render-passes/transparent/TransparentRenderPass';
import { assertFloatRenderable } from '../../core/textures/floatRenderTargets';
import { isResolvableFormat } from '../../core/textures/isResolvableFormat';
import { OutputPass } from '../../post-processing/effects/OutputPass';
import { PostEffect } from '../../post-processing/effects/PostEffect';
import type { Pass3D, PassContext } from '../../post-processing/Pass3D';
import type { ToneMapping } from '../View3D';

/**
 * Handles to the textures {@link createDefaultGraph3D} shares between its passes, so a pass added
 * on top can sample them instead of copying the scene again
 *
 * The opaque copies can be larger than the view. The view fills a sub-rect at the texture's origin,
 * so scale view UVs by the camera's `uViewportUVScale` before sampling. They match the scene's
 * resolution texel for texel.
 * @category rendering
 * @advanced
 */
export interface DefaultGraph3DHandles {
  /** Copy of the opaque scene's colour, with mipmaps, as transmissive and refractive materials see it */
  opaqueColor: ColorHandle;
  /** Copy of the opaque scene's depth; {@link CopyDepthPass} says when it's taken */
  opaqueDepth: DepthHandle;
  /** The shadow-map array, one layer per light or cascade */
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
   * Any enabled post effect in `passes`, or entry in `sceneOutputs`, turns it on. A {@link View3D}
   * sets it from {@link View3DOptions#composite}, and while its {@link View3D#resolution} differs
   * from its target's, so a custom builder that drops it draws at the target's resolution.
   */
  composite?: boolean;
  /** The view's user passes; each contributes at its own stage, post effects in array order within their stage */
  passes?: readonly Pass3D[];
  /**
   * Scene outputs to attach besides the ones the enabled `passes`
   * {@link Pass3D#requiredOutputs | require}; see {@link SceneOutput}
   *
   * Set it in a custom graph builder whose own passes use outputs. An output in both lists is
   * attached once. Any entry turns `composite` on.
   */
  sceneOutputs?: readonly SceneOutput[];
  /**
   * The view's tone mapping, which the output pass applies when an enabled `'beforeToneMapping'`
   * effect keeps the scene linear
   */
  toneMapping: ToneMapping;
  /** The view's global texture bindings; forward the value the view passes in */
  globalTextureBindings: GlobalTextureBindings;
}

/**
 * Builds the render graph a {@link View3D} uses unless its `graph` option supplies one
 *
 * Start from it in a custom `graph` builder to add passes the {@link Pass3D} stages can't
 * express. The passes run in this order, with each user pass built at its {@link PassStage}:
 *
 * 1. The shadow pass.
 * 2. `'beforeOpaque'` user passes.
 * 3. A depth reset over the view's rect, which clears each scene output but keeps any colour drawn
 *    before it, then the background and the opaque scene.
 * 4. `'afterOpaque'` user passes.
 * 5. Copies of the opaque depth and colour, then the transmissive, blended-refraction and
 *    transparent scene. Blended-refraction draws don't write scene outputs.
 * 6. `'afterTransparent'` user passes.
 * 7. The `'beforeToneMapping'` effects, in array order, then the tone curve, then the
 *    `'afterToneMapping'` effects. Unless the tone mapping is `'custom'`, an output pass applies the
 *    curve after a `'beforeToneMapping'` effect, and the scene draw applies it otherwise.
 *
 * In composite mode the scene draws into textures at {@link View3D#resolution}, which the graph's
 * other textures inherit unless an effect sets its own. The scene's textures are multisampled when
 * the canvas has `antialias`, unless a scene output's format can't be (see {@link SceneOutput}).
 * Each effect reads what the one before it wrote, and the last step stretches the image onto the
 * view's rect.
 *
 * With a `'beforeToneMapping'` effect enabled, the scene colour and every colour texture made
 * without a format are `rgba16float`, so brightness above 1 reaches each of those effects. Unless
 * the tone mapping is `'custom'`, the `'afterToneMapping'` effects read `rgba8unorm`. An effect
 * whose `inputMips` is set gets an input with mipmaps.
 *
 * The graph comes back compiled, so authoring mistakes throw here rather than on the first frame.
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
 * @param renderer - The renderer the graph draws with.
 * @param options - What the view hands its `graph` builder; see {@link DefaultGraph3DOptions}.
 * @returns The compiled graph and the {@link DefaultGraph3DHandles} its passes share.
 * @throws If a pass that isn't a {@link PostEffect} claims the `'beforeToneMapping'` or
 *   `'afterToneMapping'` stage.
 * @throws If a `'beforeToneMapping'` effect is enabled on WebGL 2 without
 *   `EXT_color_buffer_float`, which the float scene needs.
 * @category rendering
 * @advanced
 */
export function createDefaultGraph3D(
  renderer: WebGLRenderer | WebGPURenderer,
  options: DefaultGraph3DOptions,
): {
  /** The compiled render graph */
  graph: RenderGraph;
  /** Textures the default passes share */
  handles: DefaultGraph3DHandles;
} {
  const enabled = options.passes?.filter((p) => p.enabled) ?? [];
  const beforeOpaque = enabled.filter((p) => p.stage === 'beforeOpaque');
  const afterOpaque = enabled.filter((p) => p.stage === 'afterOpaque');
  const afterTransparent = enabled.filter((p) => p.stage === 'afterTransparent');
  const beforeToneMapping = enabled.filter((p): p is PostEffect => p.stage === 'beforeToneMapping');
  const afterToneMapping = enabled.filter((p): p is PostEffect => p.stage === 'afterToneMapping');
  assertPostEffects(renderer, beforeToneMapping, afterToneMapping);

  const sceneIsLinear = beforeToneMapping.length > 0;
  const toneMapping = options.toneMapping;
  const outputToneMapping = sceneIsLinear && toneMapping !== 'custom' ? toneMapping : undefined;

  const sceneOutputs = collectSceneOutputs(options.passes ?? [], options.sceneOutputs);
  const effectCount = beforeToneMapping.length + afterToneMapping.length;
  const composite = (options.composite ?? false) || effectCount > 0 || sceneOutputs.length > 0;

  const copiesScene = composite && effectCount === 0;
  const outputStep: 'outputPass'[] = outputToneMapping || copiesScene ? ['outputPass'] : [];
  const chain: (PostEffect | 'outputPass')[] = [...beforeToneMapping, ...outputStep, ...afterToneMapping];
  const firstStep = chain[0];
  const sceneColorNeedsMips = firstStep instanceof PostEffect && firstStep.inputMips;
  const antialias =
    renderer.view.antialias && sceneOutputs.every((output) => isResolvableFormat(renderer, output.format));

  const graph = new RenderGraph({
    globalTextureBindings: options.globalTextureBindings,
    defaultColor: (s: RenderSession) => s.defaultTarget.colorTexture,
    defaultDepth: (s: RenderSession) => s.defaultTarget.depthStencilTexture!,
    sceneColor: composite
      ? {
          antialias,
          autoGenerateMipmaps: sceneColorNeedsMips,
          format: sceneIsLinear ? 'rgba16float' : undefined,
          label: 'sceneColor',
        }
      : undefined,
    sceneDepth: composite ? { antialias, label: 'sceneDepth' } : undefined,
    sceneOutputs,
  });

  const opaqueColorHandle = graph.createColor({ autoGenerateMipmaps: true, label: 'opaqueColorCopy' });
  const opaqueDepthHandle = graph.createDepth({ label: 'opaqueDepthCopy' });

  const ctx: PassContext = { renderer, opaqueColor: opaqueColorHandle, opaqueDepth: opaqueDepthHandle };

  const shadowMapHandle = addShadowPass(graph, renderer);

  for (const pass of beforeOpaque) pass.build(graph, ctx);

  graph.addPass(new DepthClearPass({ renderer, attachedOutputs: sceneOutputs }));
  graph.addPass(new BackgroundPass({ renderer, attachedOutputs: sceneOutputs }));
  graph.addPass(new OpaqueRenderPass({ renderer, attachedOutputs: sceneOutputs }));

  for (const pass of afterOpaque) pass.build(graph, ctx);

  graph.addPass(new CopyDepthPass({ renderer, opaqueDepthHandle }));
  graph.addPass(new CopyOpaquePass({ renderer, opaqueColorHandle }));

  graph.addPass(new TransmissionRenderPass({ renderer, opaqueColorHandle, attachedOutputs: sceneOutputs }));
  graph.addPass(new BlendedRefractionPass({ renderer, opaqueColorHandle, opaqueDepthHandle }));
  graph.addPass(new TransparentRenderPass({ renderer, attachedOutputs: sceneOutputs }));

  for (const pass of afterTransparent) pass.build(graph, ctx);

  let input = graph.sceneColor;
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const next = chain[i + 1];
    const output =
      next === undefined
        ? null
        : graph.createColor({
            autoGenerateMipmaps: next !== 'outputPass' && next.inputMips,
            format: outputToneMapping && i >= beforeToneMapping.length ? 'rgba8unorm' : undefined,
            label: 'effectChain',
          });
    if (step === 'outputPass') {
      graph.addPass(new OutputPass({ renderer, source: input, toneMapping: outputToneMapping, writes: output }));
    } else {
      step.build(graph, { ...ctx, input, output });
    }
    if (output) input = output;
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

function assertPostEffects(
  renderer: WebGLRenderer | WebGPURenderer,
  beforeToneMapping: readonly Pass3D[],
  afterToneMapping: readonly Pass3D[],
): void {
  for (const pass of [...beforeToneMapping, ...afterToneMapping]) {
    if (!(pass instanceof PostEffect)) {
      throw new Error(
        `${pass.constructor.name}: the '${pass.stage}' stage is reserved for PostEffect subclasses (extend PostEffect, or use a scene stage).`,
      );
    }
  }
  if (beforeToneMapping.length > 0) {
    assertFloatRenderable(renderer, `View3D, for the float scene that ${beforeToneMapping[0].constructor.name} reads`);
  }
}

/**
 * Imports the shadow map through a getter, since a shadow quality change replaces the pass's target; the getter
 * first runs at execute time, after `shadowPass` is set
 */
function addShadowPass(graph: RenderGraph, renderer: WebGLRenderer | WebGPURenderer): DepthHandle {
  let shadowPass: ShadowRenderPassGpu | ShadowRenderPassGl;
  const shadowMapHandle = graph.importDepth(() => shadowPass.renderTarget.depthStencilTexture!);

  shadowPass = renderer.renderPipes.view3d.createShadowPass({ shadowMapHandle });
  graph.addPass(shadowPass);

  return shadowMapHandle;
}
