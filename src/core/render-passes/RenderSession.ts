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
 * The view's pipe builds a new one each frame, and the graph keeps
 * {@link RenderSession#activeTarget} up to date as it moves between render targets.
 *
 * ## Frames and viewports
 *
 * These are pixi's words: a *frame* is a rect in logical pixels, which is what a render-target
 * bind takes, and a *viewport* is the physical-pixel rect it resolves to, the frame times the
 * resolution. A view's placement on screen runs through these rects and one shader uniform:
 *
 * - The view camera's frame is the view's rect on screen, clipped to the screen. The screen
 *   bind takes it.
 * - {@link RenderSession#viewport} is that frame in physical pixels, in the GPU's own viewport
 *   convention, with WebGL's flip of the root target already applied. It says where the scene
 *   lands on the screen, and stays put while a camera pass draws.
 * - {@link RenderSession#activeViewport} is the live GPU rect: the bind's, or a camera pass's
 *   rect inside it. The depth clear and the size of one pass texel read it.
 * - The camera uniform `uViewportUVScale` is the viewport's size over the size of the pooled
 *   texture it sits in. It maps `[0, 1]` viewport UV onto the part of the texture the scene fills,
 *   and is `(1, 1)` when the texture matches the viewport. {@link RenderGraph#setViewportUvScale}
 *   asks the pool for it.
 *
 * In direct mode the scene passes bind the screen at the view camera's frame, and the depth clear
 * reads `activeViewport`. In composite mode they bind a pooled texture at its `Texture.frame`, and
 * the output blit, or the last post effect, draws it back onto the view's rect on screen through
 * `uViewportUVScale`.
 * @category rendering
 * @advanced
 */
export interface RenderSession {
  /** The main scene object with camera, buffers, and bind groups */
  view3d: View3D;

  /**
   * The view camera's frame resolved to a physical-pixel viewport
   *
   * In the convention the GPU viewport uses, with WebGL's flip of the root target applied. The
   * scene update writes it when it builds the view camera, so it is a mutable `Rectangle`. It
   * describes the view, not the live bind, so it doesn't move while a camera pass draws.
   */
  viewport: Rectangle;

  /** All lights collected from scene traversal */
  lights: Light[];

  /** The render target that was bound when the view started drawing, such as a filter's input */
  defaultTarget: RenderTarget;

  /**
   * The target the graph last bound and left open, or `null` when the next pass has to bind again
   *
   * Whatever closes or moves the live GPU pass (a copy, the shadow pass, mipmap generation) sets
   * it to `null`, so the next pass binds its target again.
   */
  activeTarget: RenderTarget | null;

  /**
   * Live GPU rect of {@link RenderSession#activeTarget}, in physical pixels
   *
   * The rect of the current bind, or a camera pass's rect inside it while that pass renders. The
   * depth clear and the size of one pass texel read it. It is a {@link ReadonlyRect} because it can
   * be the graph's own storage.
   */
  activeViewport: ReadonlyRect;

  /**
   * `true` until this view's depth has been reset this frame
   *
   * The pipe starts it `true`, and the first thing that clears the scene depth sets it `false`:
   * the clear on binding the scene target in composite mode, or else the depth clear pass. That
   * pass does nothing once it is `false`, so the view's depth is reset exactly once a frame.
   */
  needsDepthClear: boolean;

  /** The backend-specific global bind group for this View3D */
  globalBindGroup: BindGroup;

  /** The global uniform group for this View3D; only WebGL sets it */
  globalUniformGroup?: UniformGroup;

  /** The renderer driving this frame (WebGPURenderer or WebGLRenderer) */
  renderer: Renderer;
}
