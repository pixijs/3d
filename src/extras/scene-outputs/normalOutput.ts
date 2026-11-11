import type { SceneOutput } from '../../core/render-graph/SceneOutput';
import { normalOutputBit } from './normalOutputBit';

/**
 * Each pixel's surface normal in the camera's view space, in an `rgba8unorm` texture
 *
 * The normal is the one lighting used, after normal maps and flat shading, packed from -1 to 1
 * into 0 to 1: read it back with `rgb * 2 - 1`. View space puts `+x` right, `+y` up and `+z`
 * towards the camera, on both backends and whatever the target. Alpha is 1 where a surface wrote
 * the pixel and 0 where nothing did, such as the background. On a multisampled scene an edge pixel
 * holds the average of its samples, so alpha is the share of the pixel that surfaces cover: divide
 * `rgb` by alpha before unpacking, then normalize.
 *
 * Opaque and glass surfaces write it, as they write depth, so the two agree; blended and
 * refractive surfaces leave the normal behind them, and so does a material with a template of its
 * own. For effects that want the surface's shape, such as ambient occlusion or edge detection, it
 * beats rebuilding normals from depth: it's smooth across curves and keeps normal-map detail.
 *
 * It costs every opaque and glass pixel one more 4-byte write while a pass uses it. On a canvas with
 * `antialias` it's multisampled with the scene on WebGPU; on WebGL a view that writes it draws its
 * scene single-sample.
 * @example
 * ```ts
 * class MyEdgePass extends Pass3D {
 *   public readonly stage = 'afterTransparent';
 *   public readonly requiredOutputs = [normalOutput];
 *
 *   public build(graph: RenderGraph, ctx: PassContext): void {
 *     const normals = graph.getSceneOutput(normalOutput);
 *     graph.addPass(new MyEdgeDetectPass({ renderer: ctx.renderer, normals }));
 *   }
 * }
 * ```
 * @category extras:post-processing
 * @advanced
 */
export const normalOutput: SceneOutput = {
  name: 'normal',
  format: 'rgba8unorm',
  bits: { opaque: normalOutputBit, transmission: normalOutputBit },
};
