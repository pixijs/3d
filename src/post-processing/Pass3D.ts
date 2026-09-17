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
 *   transparents draw over it. The natural slot for hull outlines and decals.
 * - `'afterTransparent'` — after every scene draw, before the post chain. Overlays, gizmos,
 *   debug wireframes.
 * - `'post'` — the fullscreen post chain, reserved for {@link PostEffect}.
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
 * @category rendering
 * @standard
 */
export interface Pass3DOptions {
  /**
   * Whether the pass is included in the compiled graph
   * @default true
   */
  enabled?: boolean;
}

/**
 * Something a user adds to {@link View3D#passes}: a renderer-free object that installs one or
 * more render passes into the view's graph at a declared {@link PassStage}
 *
 * The object is the user's handle — constructed with no renderer, surviving every graph
 * rebuild, shareable across views, carrying the live properties the user tunes. At graph
 * build it contributes real passes via {@link Pass3D#build}; the stage decides where in the
 * default graph that call happens, so a user never orders scene passes against post effects
 * by hand. Array order only matters between passes at the same stage.
 *
 * Two built-in shapes cover most needs: {@link MeshPass} redraws opted-in meshes with an
 * override shader, and {@link PostEffect} runs a fullscreen fragment over the frame. Anything
 * else subclasses this directly and talks to the graph.
 * @category rendering
 * @standard
 */
export abstract class Pass3D {
  /**
   * Whether this pass is included in the compiled graph
   *
   * Flipping it rebuilds the view's graph on the next render and re-keys every mesh against
   * the new pass set: fine for a settings toggle, not a per-frame lever. Animate an effect's
   * own properties instead; those are plain uniform writes.
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
   * Teardown seam for passes that own GPU resources outside the graph
   *
   * Graph passes and their shaders are torn down with the view's graph; a plain
   * `UniformGroup` needs no release. Reassigning `view.passes` never calls this.
   */
  public destroy(): void {}
}
