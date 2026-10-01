import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import { RenderPass, RenderPassBit } from '../RenderPass';
import type { RenderSession } from '../RenderSession';

/**
 * Options for constructing a {@link DepthClearPass}
 * @internal
 */
interface DepthClearPassOptions {
  /** The renderer this pass will draw with */
  renderer: WebGLRenderer | WebGPURenderer;
  /**
   * Camera whose rect to reset, instead of the view's
   *
   * A camera's reset always runs: `session.needsDepthClear` tracks only the view's own reset, and
   * an inset drawn after the scene needs its own either way.
   */
  camera?: Camera3D;
}

/**
 * Resets this View3D's depth to the far plane over `session.activeViewport`, before the opaque pass
 *
 * Only the viewport is reset, so the opaque draw tests against fresh depth while other insets and
 * 2D content sharing the depth buffer keep theirs. A clear of the whole attachment would wipe them.
 *
 * The reset runs only while `session.needsDepthClear` is `true`. In composite mode, binding the
 * scene target clears the depth first, so this pass does nothing. In direct mode the screen is
 * bound with no clear, so that several views can draw in one GPU pass, and this pass always runs.
 * It stays in the graph in both modes, since being the scene target's first writer is what gives
 * the composite bind its clear.
 *
 * One class for both backends, through `pipe.clearDepth`: WebGPU draws a fullscreen triangle with
 * colour writes masked off, and WebGL scissors a `gl.clear` of the depth. The pass declares colour
 * as well as depth so it lands on the same target as the opaque pass, but clears only depth.
 * @internal
 */
export class DepthClearPass extends RenderPass {
  constructor(options: DepthClearPassOptions) {
    super({
      renderer: options.renderer,
      name: 'depthClear',
      description: 'Clears this View3D depth region before scene geometry renders.',
      bit: RenderPassBit.NONE,
      camera: options.camera,
    });
  }

  /**
   * Declares colour and depth writes, which put the pass on its camera's target or the scene's
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.writeColor(b.targetColor);
    b.writeDepth(b.targetDepth);
  }

  /**
   * Clears the depth of `session.activeViewport`
   *
   * Without a camera that is the view's rect, cleared once a frame: the pass sets
   * `session.needsDepthClear` to `false`, and skips when a composite bind already did. With a
   * camera the graph has already narrowed the viewport to the camera's rect, and the reset always
   * runs.
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    if (!this.camera) {
      if (!session.needsDepthClear) return;
      session.needsDepthClear = false;
    }
    this.pipe.clearDepth(session);
  }
}
