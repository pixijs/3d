import { ForwardRenderPass } from '../../../../core/render-passes/ForwardRenderPass';
import type { ForwardRenderPassOptions } from '../../../../core/render-passes/ForwardRenderPass';
import type { RenderSession } from '../../../../core/render-passes/RenderSession';

interface PortalFeedPassOptions extends ForwardRenderPassOptions {
  /** Poses the portal camera when it returns true; both feed passes call it, so it answers once per session */
  shouldDraw: (session: RenderSession) => boolean;
}

/**
 * Asks the portal whether to draw from `condition`, which runs after the transform walk and before pass cameras
 * are built: the one point where the portal can read this frame's viewer and pose its camera
 * @internal
 */
export class PortalFeedPass extends ForwardRenderPass {
  private readonly _shouldDraw: (session: RenderSession) => boolean;

  constructor(options: PortalFeedPassOptions) {
    super(options);
    this._shouldDraw = options.shouldDraw;
  }

  public override condition(session: RenderSession): boolean {
    return this._shouldDraw(session) && super.condition(session);
  }
}
