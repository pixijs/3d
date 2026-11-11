import type { Rectangle, RenderTarget, BindGroup, UniformGroup, Renderer } from 'pixi.js';

import type { Light } from '../../scene/lights/Light';
import type { View3D } from '../../scene/View3D';

/**
 * Read-only view of a rect, for session rects the graph owns
 * @category rendering
 * @advanced
 */
export type ReadonlyRect = Readonly<Pick<Rectangle, 'x' | 'y' | 'width' | 'height'>>;

/**
 * Everything a render pass gets for the frame it draws
 *
 * The view's pipe builds one each frame and hands it to every pass's `condition`, `prepare` and
 * `render`.
 * @category rendering
 * @advanced
 */
export interface RenderSession {
  /** The view being drawn */
  view3d: View3D;

  /**
   * The view's rect in {@link RenderSession#defaultTarget}, clipped to that target, in physical
   * pixels as the GPU viewport takes it; on WebGL the root target's flip is already applied
   *
   * It stays put while a camera pass draws; {@link RenderSession#activeViewport} is the live rect.
   */
  viewport: Rectangle;

  /** The lights in the view's scene */
  lights: Light[];

  /** The render target that was bound when the view started drawing, such as a filter's input */
  defaultTarget: RenderTarget;

  /**
   * Whether pixi inverts the front face for {@link RenderSession#defaultTarget}
   *
   * A pass that draws a fixed clip-space shape, such as a fullscreen triangle, compares its own
   * target's inversion with this to know whether to flip V.
   */
  defaultFrontFaceInverted: boolean;

  /**
   * The target the graph last bound and left open, or `null` when the next pass has to bind again
   *
   * A pass that binds another target or ends the GPU pass must set it to `null`, so the next pass
   * binds its target again.
   */
  activeTarget: RenderTarget | null;

  /**
   * Live GPU rect of {@link RenderSession#activeTarget} in physical pixels, narrowed to a camera pass's
   * rect while it renders
   */
  activeViewport: ReadonlyRect;

  /** `true` until the view's depth has been cleared this frame; whatever clears it sets this `false` */
  needsDepthClear: boolean;

  /** The backend-specific global bind group for this View3D */
  globalBindGroup: BindGroup;

  /** The global uniform group for this View3D; only WebGL sets it */
  globalUniformGroup?: UniformGroup;

  /** The renderer driving this frame (WebGPURenderer or WebGLRenderer) */
  renderer: Renderer;
}
