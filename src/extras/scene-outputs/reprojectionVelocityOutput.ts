import type { SceneOutput } from '../../core/render-graph/SceneOutput';
import { reprojectionVelocityBit } from './velocityBit';

/**
 * The motion of {@link velocityOutput}, not clamped, in an `rgba16float` texture, for reprojection
 * such as temporal antialiasing or upscaling
 *
 * `xy` holds the same value as {@link velocityOutput}, with the same units, sign and surfaces that
 * write it, without the ±1 clamp. A camera cut without {@link Camera3D#resetHistory} reads its whole
 * jump, so `uv - xy` lands outside 0 to 1 and a pass can drop its history there. `z` and `w` read 0
 * and are reserved. A view can write it alongside {@link velocityOutput}.
 * @example
 * ```ts
 * class MyTemporalPass extends Pass3D {
 *   public readonly stage = 'afterTransparent';
 *   public readonly requiredOutputs = [reprojectionVelocityOutput];
 *
 *   public build(graph: RenderGraph, ctx: PassContext): void {
 *     const velocity = graph.getSceneOutput(reprojectionVelocityOutput);
 *     graph.addPass(new MyResolvePass({ renderer: ctx.renderer, velocity }));
 *   }
 * }
 * ```
 * @category extras:post-processing
 * @advanced
 */
export const reprojectionVelocityOutput: SceneOutput = {
  name: 'reprojectionVelocity',
  format: 'rgba16float',
  bits: { opaque: reprojectionVelocityBit },
};
