import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { RenderSession } from '../render-passes/RenderSession';
import type { PassBuilder } from './PassBuilder';

/**
 * Contract for a pass added to the {@link RenderGraph}
 *
 * {@link RenderPass} satisfies it, and so does a plain object with `name`, `setup` and `render`.
 * @category rendering
 * @advanced
 */
export interface GraphRenderPass {
  /** Pass name — identifies the pass in graph diagnostics and debug tooling */
  readonly name: string;
  /** Optional human-readable explanation of what the pass contributes to the frame */
  readonly description?: string;
  /**
   * The pass's {@link RenderPassBit}, which keys its draw lists
   *
   * When a texture the pass samples changes, the graph re-records the pass's WebGPU render
   * bundles. A pass that draws no meshes leaves it out or uses `0`.
   */
  readonly bit?: number;
  /**
   * Camera this pass draws from, or `null` or absent for the view's own
   *
   * A camera with a render texture draws into a target of its own, which the graph copies into the
   * texture. Any other camera draws into its frame within the view: the graph narrows the GPU
   * viewport and `session.activeViewport` to it for the duration of `render`.
   */
  readonly camera?: Camera3D | null;
  /**
   * Declare the pass's resource accesses
   *
   * Runs once at graph build time.
   * @param {PassBuilder} builder - Access-declaration API scoped to this pass.
   */
  setup(builder: PassBuilder): void;
  /**
   * Optional upload step, run for every active pass before any render target is bound
   *
   * Cameras are already built, and no render pass is open, so a culling compute dispatch can run here.
   */
  prepare?(session: RenderSession): void;
  /** Record the pass's rendering; runs per frame, after the graph has bound the target and sample-slot resources */
  render(session: RenderSession): void;
  /**
   * Optional per-frame cull
   * @param {RenderSession} session - The frame's render session.
   * @returns `false` to drop the pass for this frame.
   */
  condition?(session: RenderSession): boolean;
  /**
   * Optional "give the memory back now" hook, forwarded by {@link RenderGraph#unload}
   *
   * Free whatever the pass can rebuild lazily (the shadow pass frees its map); anything
   * freed here must re-create itself on the next frame that needs it. Unlike `destroy`
   * this may be called any number of times, and the pass keeps rendering afterwards.
   */
  unload?(): void;
  /** Optional teardown; called once when the graph is destroyed */
  destroy?(): void;
}
