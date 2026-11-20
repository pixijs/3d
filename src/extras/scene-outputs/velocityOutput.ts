import type { SceneOutput } from '../../core/render-graph/SceneOutput';
import { velocityBit } from './velocityBit';

/**
 * How far each pixel's surface moved on screen since the camera's previous render, in an
 * `rg16float` texture
 *
 * The value is the surface's UV now minus its UV at the previous render, with UV running 0 to 1
 * across the view's image, so `uv - velocity` is where the surface was in last frame's image. It
 * counts the camera's motion and each mesh's own, {@link BatchedMesh3D} slots included: a car
 * passing a still camera reads its speed, and a cockpit parented to a moving camera reads zero.
 * Skinning and morph targets count too, so a character's swinging arm reads its swing. A mesh reads
 * none of its own motion on its first render in the view.
 *
 * `v` runs the way the scene texture's rows do, like the `uv` an `effect(uv)` receives, so
 * `uv - velocity` works on both backends and any target. Which way `v` points on screen varies
 * with both, so turn it into a screen direction only for display. The texture is pooled and can
 * be larger than the view: a {@link FullscreenPass} maps `uv` onto it in `sampleColor` and
 * `sampleColor2`, and a shader of your own scales a view UV by the camera's `uViewportUVScale`
 * first.
 *
 * Each camera compares with its own previous render, so a view drawn twice in a frame reads no
 * camera motion the second time; give that render a camera of its own. A mesh's own motion counts
 * since the view's previous render, whichever camera drew it, so only the first of those renders
 * reads it. A camera's first render reads none of the camera's motion. A camera cut reads the jump
 * between shots for one frame; call {@link Camera3D#resetHistory} on the cut so it reads none
 * instead. The camera's `jitter` cancels out, and each component is clamped to ±1. On a canvas with
 * `antialias` the velocity is multisampled with the scene, so an edge pixel reads the average of its
 * samples, counting zero where nothing drew.
 *
 * Opaque surfaces write it. One whose material has a template of its own doesn't, so its pixels
 * keep zero or the motion of a surface behind it that drew first. Blended, glass and refractive
 * surfaces leave the opaque value under them. Where nothing drew, the background included, it
 * reads zero, so a turning camera's sky reads as still.
 * @example
 * ```ts
 * class MyTemporalPass extends Pass3D {
 *   public readonly stage = 'afterTransparent';
 *   public readonly requiredOutputs = [velocityOutput];
 *
 *   public build(graph: RenderGraph, ctx: PassContext): void {
 *     const velocity = graph.getSceneOutput(velocityOutput);
 *     graph.addPass(new MyResolvePass({ renderer: ctx.renderer, velocity }));
 *   }
 * }
 * ```
 * @category extras:post-processing
 * @advanced
 */
export const velocityOutput: SceneOutput = {
  name: 'velocity',
  format: 'rg16float',
  bits: { opaque: velocityBit },
};
