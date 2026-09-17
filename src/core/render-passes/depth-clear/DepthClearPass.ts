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
   * A camera pass resets its own rect unconditionally: `session.needsDepthClear` is the
   * *view's* one reset, and an inset drawn after the scene needs its own regardless.
   */
  camera?: Camera3D;
}

/**
 * Resets this View3D's depth to the far plane over `session.activeViewport`, before Opaque
 *
 * Scoping the reset to the viewport means opaque geometry depth-tests against fresh
 * depth while the overlapping insets / 2D content sharing the one depth buffer survive
 * (a whole-attachment clear would wipe them).
 *
 * The manual clear runs only while `session.needsDepthClear` is unspent: in
 * composite mode the scene-target bind's load-op clear spends it first (the
 * executor marks it), so this pass draws nothing there; in direct mode the
 * screen bind never clears (`CLEAR.NONE` keeps the keep-open weave), so it
 * always runs. The pass stays in the graph in both modes — its declarations
 * make it the scene target's first writer, which is what gives the composite
 * bind its clear in the first place.
 *
 * One class for both backends: the divergent technique lives behind
 * `pipe.clearDepth` (WebGPU rasterises a fullscreen triangle with colour-mask
 * off; WebGL scissors a native `gl.clear(DEPTH)`). Declaring colour + depth
 * resolves the pass to the default colour+depth target (a depth-only decl would
 * resolve elsewhere) and keeps it in the keep-open flow; only depth is cleared.
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
   * Declares colour + depth writes so the pass resolves to this camera's target, or the scene pair
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.writeColor(b.targetColor);
    b.writeDepth(b.targetDepth);
  }

  /**
   * Clears the depth of `session.activeViewport`
   *
   * Without a camera that is the view's rect, once per view — `session.needsDepthClear` is
   * spent so a composite bind's load-op clear can satisfy it instead. With a camera the
   * executor has already pointed the live frame at that camera, and the reset always runs:
   * the view's flag says nothing about an inset.
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
