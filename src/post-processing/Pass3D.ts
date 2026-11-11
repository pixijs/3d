import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { RenderGraph } from '../core/render-graph/RenderGraph';
import type { ColorHandle, DepthHandle } from '../core/render-graph/ResourceHandle';
import type { SceneOutput } from '../core/render-graph/SceneOutput';

/**
 * The stages where a pass draws meshes into the scene; see {@link PassStage}
 * @example
 * ```ts
 * new MeshPass({ name: 'gizmo', stage: 'afterTransparent' });
 * ```
 * @category rendering
 * @standard
 */
export type SceneStage = 'beforeOpaque' | 'afterOpaque' | 'afterTransparent';

/**
 * The stages of the post chain, before and after the view's tone curve, reserved for
 * {@link PostEffect}; see {@link PassStage}
 * @example
 * ```ts
 * view.passes = [new BloomEffect(), new TintEffect({ stage: 'beforeToneMapping' })];
 * ```
 * @category rendering
 * @standard
 */
export type EffectStage = 'beforeToneMapping' | 'afterToneMapping';

/**
 * Where in the default graph a {@link Pass3D} contributes its passes
 *
 * The first three are scene stages ({@link SceneStage}), where a pass usually draws meshes into the
 * scene's colour and depth. The last two are the post chain ({@link EffectStage}), where
 * full-screen effects each read the image the one before wrote.
 *
 * - `'beforeOpaque'`: before the view clears its depth and draws the scene, so a pass here can fill
 *   a texture the scene then samples: a security-camera feed, a mirror, a portal.
 * - `'afterOpaque'`: straight after the opaque draw, so glass refracts what the pass draws and
 *   transparent surfaces draw over it. Suits outlines and decals. A pass whose camera has a render
 *   texture draws into that texture instead, so glass doesn't refract it.
 * - `'afterTransparent'`: after every scene draw, before the post chain. Overlays, gizmos,
 *   debug wireframes.
 * - `'beforeToneMapping'`: post effects that read the scene as light, in a float texture, before
 *   the view's tone curve, so brightness above 1 is still there: bloom, depth of field, motion
 *   blur, ambient occlusion. A {@link PostEffect} runs here unless it says otherwise.
 * - `'afterToneMapping'`: post effects that read the picture as it will show, after the curve,
 *   such as antialiasing that finds edges by their brightness on screen, a tint, or a viewer that
 *   shows data as colours.
 * @example
 * ```ts
 * view.passes = [new MeshPass({ name: 'gizmo', stage: 'afterTransparent' })];
 * ```
 * @category rendering
 * @standard
 */
export type PassStage = SceneStage | EffectStage;

/**
 * What a {@link Pass3D} receives at build time
 *
 * Scene-stage passes draw into `graph.sceneColor` and `graph.sceneDepth`. Post effects receive
 * {@link EffectIO}, which adds their input and output.
 * @category rendering
 * @advanced
 */
export interface PassContext {
  /** Renderer the graph is being built for */
  readonly renderer: WebGLRenderer | WebGPURenderer;
  /** Copy of the scene's colour after the opaque draw, with mips; the image glass refracts */
  readonly opaqueColor: ColorHandle;
  /** Copy of the scene's depth after the opaque draw */
  readonly opaqueDepth: DepthHandle;
}

/**
 * Constructor options shared by every {@link Pass3D}
 * @example
 * ```ts
 * interface MyGridPassOptions extends Pass3DOptions {
 *   spacing?: number;
 * }
 * ```
 * @category rendering
 * @standard
 */
export interface Pass3DOptions {
  /**
   * Whether the pass starts enabled; see {@link Pass3D#enabled}
   * @default true
   * @example
   * ```ts
   * view.passes = [new MeshPass({ name: 'wireframe', enabled: false })];
   * ```
   */
  enabled?: boolean;
}

/**
 * Base class for everything added to {@link View3D#passes}
 *
 * A pass needs no renderer to construct, can be shared across views, and holds the properties you
 * tune. When a view builds its render graph, it calls {@link Pass3D#build} at the pass's
 * {@link PassStage}, and the pass adds its render passes there. Array order only matters between
 * passes at the same stage.
 *
 * {@link MeshPass} redraws opted-in meshes with an override shader, and {@link PostEffect} runs a
 * fullscreen fragment over the frame. Subclass this directly for anything else.
 * @example
 * ```ts
 * class MyRearViewPass extends Pass3D {
 *   public readonly stage = 'afterTransparent';
 *
 *   public build(graph: RenderGraph, ctx: PassContext): void {
 *     graph.addPass(
 *       new ForwardRenderPass({ renderer: ctx.renderer, name: 'opaque', sort: 'key', camera: rearCamera }),
 *     );
 *   }
 * }
 *
 * view.passes = [new MyRearViewPass()];
 * ```
 * @category rendering
 * @standard
 */
export abstract class Pass3D {
  /**
   * Whether this pass runs
   *
   * Flipping it rebuilds the view's render graph on the next render, which suits a settings toggle
   * but not a change every frame; animate an effect's own properties instead. It can also
   * recompile the view's materials; {@link View3D#passes} says when.
   * @example
   * ```ts
   * const wireframe = new MeshPass({ name: 'wireframe' });
   * view.passes = [wireframe];
   * wireframe.enabled = false;
   * ```
   */
  public enabled: boolean;

  /** The {@link PassStage} at which the view calls {@link Pass3D#build} */
  public abstract readonly stage: PassStage;

  /**
   * Extra outputs the view's scene draw writes beside its colour while this pass is enabled
   *
   * Each costs the scene draw a texture and the shader work to fill it, and any output makes the
   * view draw its scene into a texture first, as a post effect does. Reach an output's texture with
   * {@link RenderGraph#getSceneOutput}, to read it or draw into it.
   * @example
   * ```ts
   * const objectIdOutput: SceneOutput = { name: 'objectId', format: 'r32uint' };
   *
   * class MyPickingPass extends Pass3D {
   *   public readonly stage = 'afterTransparent';
   *   public readonly requiredOutputs = [objectIdOutput];
   *   public build(): void {}
   * }
   * ```
   */
  public readonly requiredOutputs?: readonly SceneOutput[];

  constructor(options: Pass3DOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  /**
   * Adds this pass's render passes and textures to the graph
   *
   * Called once per graph build at this pass's stage. Handles become textures only inside a render
   * pass's `render(session)`, through {@link RenderGraph#getTexture}, never here.
   * @param graph - Render graph being built; add passes and transients to it.
   * @param ctx - Renderer and shared handles for this build.
   * @advanced
   */
  public abstract build(graph: RenderGraph, ctx: PassContext): void;

  /**
   * Releases GPU resources the pass made outside the graph; the base class has none
   *
   * The view never calls it, not on replacing `view.passes` nor on its own destroy, since a pass
   * can be shared. Call it yourself once the pass is retired. Override it only for resources of your
   * own: the render passes added in `build` go with the view's graph, and a plain `UniformGroup`
   * needs no release.
   * @example
   * ```ts
   * view.passes = [];
   * wireframe.destroy();
   * ```
   */
  public destroy(): void {}
}
