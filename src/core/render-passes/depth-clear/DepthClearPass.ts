import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { SceneOutput } from '../../render-graph/SceneOutput';
import { RenderPass, RenderPassBit } from '../RenderPass';
import type { RenderSession } from '../RenderSession';

interface DepthClearPassOptions {
  renderer: WebGLRenderer | WebGPURenderer;
  camera?: Camera3D;
  attachedOutputs?: readonly SceneOutput[];
}

/**
 * Clears depth over `session.activeViewport` only, so other views and 2D content sharing the depth
 * buffer keep theirs
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
      attachedOutputs: options.attachedOutputs,
    });
  }

  /**
   * Writes colour and the scene outputs as well as depth, to share the scene passes' target; on an
   * offscreen target, its bind as first writer does the clear
   */
  public override setup(b: PassBuilder): void {
    this._writeTarget(b);
  }

  /** Always clears for a camera, since `session.needsDepthClear` tracks only the view's own clear */
  public override render(session: RenderSession): void {
    if (!this.camera) {
      if (!session.needsDepthClear) return;
      session.needsDepthClear = false;
    }
    this.pipe.clearDepth(session);
  }
}
