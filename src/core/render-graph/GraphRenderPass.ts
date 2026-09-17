import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { RenderSession } from '../render-passes/RenderSession';
import type { PassBuilder } from './PassBuilder';

/**
 * Contract for a pass added to the {@link RenderGraph}
 *
 * Satisfied structurally by the existing `RenderPass` base class in
 * `core/render-passes/RenderPass.ts`.
 * @category rendering
 * @advanced
 */
export interface GraphRenderPass {
  /** Pass name — identifies the pass in graph diagnostics and debug tooling */
  readonly name: string;
  /** Optional human-readable explanation of what the pass contributes to the frame */
  readonly description?: string;
  /**
   * Forward-pass render bit (indexes `drawLists`). Present on mesh-drawing
   * passes; the graph uses it to invalidate that pass's cached WebGPU bundles
   * when a sampled transient's source changes. Absent on passes that sample
   * nothing (copy / background), so optional here.
   */
  readonly bit?: number;
  /**
   * Camera this pass draws from, or `null`/absent to draw from the view's own
   *
   * The executor narrows the GPU viewport to this camera's frame — and swaps the session's
   * rects to match — for the duration of `render`.
   */
  readonly camera?: Camera3D | null;
  /**
   * Declare the pass's resource accesses
   *
   * Runs once at graph build time.
   * @param {PassBuilder} builder - Access-declaration API scoped to this pass.
   */
  setup(builder: PassBuilder): void;
  /** Optional prepare phase — GPU uploads before any target is bound; cameras are already built */
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
   * Optional "give the memory back now" hook, forwarded by `RenderGraph.unload`
   *
   * Free whatever the pass can rebuild lazily (the shadow pass frees its map); anything
   * freed here must re-create itself on the next frame that needs it. Unlike `destroy`
   * this may be called any number of times, and the pass keeps rendering afterwards.
   */
  unload?(): void;
  /** Optional teardown; called once when the graph is destroyed */
  destroy?(): void;
}
