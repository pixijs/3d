import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { RenderSession } from '../render-passes/RenderSession';
import type { PassBuilder } from './PassBuilder';

/**
 * What {@link RenderGraph#addPass} takes: a {@link RenderPass}, or a plain object with `name`,
 * `setup` and `render`
 * @category rendering
 * @advanced
 */
export interface GraphRenderPass {
  /** Names the pass in errors and debug tools */
  readonly name: string;
  /** What the pass adds to the frame, shown by debug tools */
  readonly description?: string;
  /** The {@link RenderPassBit} of the meshes the pass draws; give {@link RenderPassBit.NONE} on a pass that draws none */
  readonly bit?: number;
  /**
   * Camera this pass draws from, or `null` or absent for the view's own
   *
   * A camera with a render texture draws into that texture. Any other camera draws into its frame
   * within the view: while `render` runs on a pass with attachments, the GPU viewport and
   * `session.activeViewport` cover only that frame.
   */
  readonly camera?: Camera3D | null;
  /**
   * Declares the textures the pass reads and writes; runs once, when the pass is added
   * @param {PassBuilder} builder - Records the declarations for this pass.
   */
  setup(builder: PassBuilder): void;
  /**
   * Runs on each frame the pass runs, before any pass renders, for uploads and compute work such as
   * culling; the cameras are already updated
   */
  prepare?(session: RenderSession): void;
  /** Draws the pass on each frame it runs, after the graph binds the textures it samples and any target it declared */
  render(session: RenderSession): void;
  /**
   * Return `false` to skip the pass this frame, `prepare` included, and any pass that only feeds it
   *
   * A later pass that reads what this one writes isn't skipped with it, and sees whatever the texture
   * last held. For a texture the graph allocates, that can be another pass's leftovers; to keep a
   * result across skipped frames, write it into one you import with {@link RenderGraph#importColor}.
   * @param {RenderSession} session - The frame's render session.
   * @returns Whether the pass runs this frame.
   */
  condition?(session: RenderSession): boolean;
  /**
   * Frees GPU memory the pass can rebuild, such as the shadow pass's map; {@link RenderGraph#unload} calls it
   *
   * It can run any number of times and the pass keeps rendering, so whatever it frees must come
   * back on the next frame that needs it.
   */
  unload?(): void;
  /** Releases the pass; the graph calls it once, when it is destroyed */
  destroy?(): void;
}
