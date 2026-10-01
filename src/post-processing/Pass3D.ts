import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { RenderGraph } from '../core/render-graph/RenderGraph';
import type { ColorHandle, DepthHandle } from '../core/render-graph/ResourceHandle';

/**
 * Where in the default graph a {@link Pass3D} contributes its passes
 *
 * - `'beforeOpaque'` — before the view's own depth reset and any scene draw. Nothing in the
 *   frame has been drawn yet, so this is where a pass fills a texture the scene then samples:
 *   a security-camera feed, a mirror, a portal.
 * - `'afterOpaque'` — straight after the opaque draw, before the opaque colour and depth
 *   copies are taken. The pass is part of the opaque world: glass refracts it and
 *   transparents draw over it. The natural slot for hull outlines and decals. A pass on a
 *   camera with a render texture draws into that camera's own target at every stage, so the
 *   view's copies leave it out.
 * - `'afterTransparent'` — after every scene draw, before the post chain. Overlays, gizmos,
 *   debug wireframes.
 * - `'post'` — the fullscreen post chain, reserved for {@link PostEffect}.
 * @example
 * ```ts
 * view.passes = [new MeshPass({ name: 'gizmo', stage: 'afterTransparent' })];
 * ```
 * @category rendering
 * @standard
 */
export type PassStage = 'beforeOpaque' | 'afterOpaque' | 'afterTransparent' | 'post';

/**
 * What the default graph hands a {@link Pass3D} at build time
 *
 * Scene-stage passes draw into `graph.sceneColor` / `graph.sceneDepth` and may sample the
 * opaque copies from here. The post chain extends this with its input/output handles
 * (see {@link EffectIO}).
 * @category rendering
 * @advanced
 */
export interface PassContext {
  /** Renderer the graph is being built for */
  readonly renderer: WebGLRenderer | WebGPURenderer;
  /** Mip-chained copy of the opaque colour buffer, shared with the glass passes */
  readonly opaqueColor: ColorHandle;
  /** Copy of the opaque depth buffer */
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
   * Whether the pass runs; {@link Pass3D#enabled} covers what toggling it costs
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
 * A pass object is the handle on an extra rendering step. It is constructed without a renderer,
 * survives every graph rebuild, can be shared across views, and carries the live properties you
 * tune. When a view builds its graph it calls {@link Pass3D#build} at the pass's
 * {@link PassStage}, and the pass adds its render passes there. The stage places the pass, so
 * scene passes are never ordered against post effects by hand; array order only matters between
 * passes at the same stage.
 *
 * Two built-in shapes cover most needs: {@link MeshPass} redraws opted-in meshes with an
 * override shader, and {@link PostEffect} runs a fullscreen fragment over the frame. Anything
 * else subclasses this directly and talks to the graph.
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
   * Flipping it rebuilds the view's graph on the next render and re-keys every mesh against
   * the new pass set: fine for a settings toggle, not a per-frame lever. Animate an effect's
   * own properties instead; those are plain uniform writes.
   * @example
   * ```ts
   * const wireframe = new MeshPass({ name: 'wireframe' });
   * view.passes = [wireframe];
   * wireframe.enabled = false;
   * ```
   */
  public enabled: boolean;

  /** Stage of the default graph at which {@link Pass3D#build} is called */
  public abstract readonly stage: PassStage;

  constructor(options: Pass3DOptions = {}) {
    this.enabled = options.enabled ?? true;
  }

  /**
   * Contribute this pass's graph passes and transients
   *
   * Called once per graph build at this pass's stage. Handles resolve to textures only inside
   * a pass's `render(session)` — never here.
   * @param graph - Render graph being built; add passes and transients to it.
   * @param ctx - Renderer and shared handles for this build.
   * @advanced
   */
  public abstract build(graph: RenderGraph, ctx: PassContext): void;

  /**
   * Release GPU resources the pass owns outside the graph; the base implementation does nothing
   *
   * Override it only for such resources: the passes added in `build` and their shaders are torn
   * down with the view's graph, and a plain `UniformGroup` needs no release. The view never calls
   * this, on reassigning `view.passes` or on its own destroy, because a pass may be shared across
   * views. Call it yourself when the pass is retired.
   * @example
   * ```ts
   * view.passes = [];
   * wireframe.destroy();
   * ```
   */
  public destroy(): void {}
}
