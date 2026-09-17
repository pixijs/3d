import type { Rectangle, RenderTarget, BindGroup, UniformGroup, Renderer } from 'pixi.js';

import type { Light } from '../../scene/lights/Light';
import type { View3D } from '../../scene/View3D';

/**
 * Read-only view of a rect
 *
 * A session rect that aliases live executor storage is exposed through this type so
 * consumers can't mutate shared state through the session.
 * @category rendering
 * @advanced
 */
export type ReadonlyRect = Readonly<Pick<Rectangle, 'x' | 'y' | 'width' | 'height'>>;

/**
 * All data render passes need for a single frame
 *
 * Created fresh each frame by `View3DPipe.execute()`. The pipeline loop populates
 * {@link RenderSession#activeTarget} as it transitions between render targets.
 *
 * ## Frames and viewports
 *
 * Pixi's words: a *frame* is a rect in logical pixels, what `bind` is handed; a *viewport* is
 * the physical-pixel rect that frame resolves to. A View3D's placement flows through these
 * plus one shader lane:
 *
 * - the view camera's `CameraData.frame` — the View's on-screen rect, clipped to the screen.
 *   What the screen bind is handed.
 * - {@link RenderSession#viewport} — that frame in physical pixels, in the live GPU
 *   viewport convention (WebGL root Y-flip baked in): where the scene lands on
 *   the *screen*. A fact about the view. It does not move for a camera pass.
 * - {@link RenderSession#activeViewport} — the live GPU rect. The bind, or a camera
 *   pass's frame within it. Copies, depth clear, and pass texel size read this.
 * - the camera group's `uViewportUVScale` — `viewport / pooledTextureSize`: maps `[0,1]`
 *   viewport UV onto a transient's sub-rect (`(1,1)` when the texture matches the viewport).
 *   Asked of the pool via {@link RenderGraph#setViewportUvScale}.
 *
 * Direct mode: scene passes bind the screen at the view camera's frame; copies and depth
 * clear read `activeViewport`. Composite mode: scene passes bind a pooled transient
 * at its `Texture.frame`; `OutputPass` blits it back onto the screen rect, sampling
 * through `uViewportUVScale`.
 * @category rendering
 * @advanced
 */
export interface RenderSession {
  /** The main scene object with camera, buffers, and bind groups */
  view3d: View3D;

  /**
   * The view camera's frame resolved to a physical-pixel viewport
   *
   * Same lower-left-origin convention as the live `gl.viewport` / WebGPU viewport; the
   * WebGL root Y-flip is baked in. Written when the scene update builds the view camera —
   * hence a mutable `Rectangle`. A fact about the view, not the live bind: it does not move
   * for a camera pass.
   */
  viewport: Rectangle;

  /** All lights collected from scene traversal */
  lights: Light[];

  /** The render target that was active when the pipeline started (respects filters) */
  defaultTarget: RenderTarget;

  /**
   * The target the pipeline loop has established as the live open pass (null = none /
   * needs re-establishing)
   *
   * Self-managing passes that close or divert the live pass (CopyOpaque, Shadow) null
   * it so the next default-target pass rebinds.
   */
  activeTarget: RenderTarget | null;

  /**
   * Live GPU rect of {@link RenderSession#activeTarget}, in physical pixels
   *
   * The rect of the current bind, or a camera pass's frame within it for the duration of
   * that `render`. Copies, depth clear, and pass texel size read this. Typed
   * {@link ReadonlyRect} so shared state can't be mutated through it.
   */
  activeViewport: ReadonlyRect;

  /**
   * True until this view's depth has been reset this frame
   *
   * Initialised `true` by the pipe; spent (set `false`) by the first thing that clears
   * the scene depth — the scene-target bind's load-op clear in composite mode, else
   * DepthClearPass's manual clear. DepthClearPass no-ops once spent, so the reset
   * happens exactly once per view however the graph provides it.
   */
  needsDepthClear: boolean;

  /** The backend-specific global bind group for this View3D */
  globalBindGroup: BindGroup;

  /** The backend-specific global uniform group for this View3D */
  globalUniformGroup?: UniformGroup;

  /** The renderer driving this frame (WebGPURenderer or WebGLRenderer) */
  renderer: Renderer;
}
