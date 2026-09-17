import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import { ForwardRenderPass } from '../ForwardRenderPass';
import { RenderPassBit } from '../RenderPass';

/**
 * Options for `TransparentRenderPass`
 * @internal
 */
interface TransparentRenderPassOptions {
  /** Renderer the pass draws with */
  renderer: WebGLRenderer | WebGPURenderer;
  /** Camera to draw from; omitted, the view's own camera is used */
  camera?: Camera3D;
}

/**
 * Plain transparent 3D mesh pass
 *
 * Alpha-blended materials with no opaque-handle sampling (smoke, particles, simple alpha
 * sprites). Refractive blended materials (water etc.) route through `BlendedRefractionPass`.
 *
 * One class for both backends, programming against the `View3DPipe` interface only — no
 * `core/gpu/**` or `core/gl/**` runtime imports. The draw is declared `sort: 'distance'` via
 * `ForwardRenderPass`: back-to-front by camera distance, recomputed every frame (no caching).
 * The pipe owns the camera read and the per-backend distance math (WebGPU store-buffer path vs.
 * WebGL store/world-matrix split).
 *
 * `sort: 'distance'` also sets `_updatesViewKey = false` in the base: the inherited
 * `onRenderableDirty` still (re)computes the batch key, but does NOT touch the sorted-view key —
 * transparent order is distance-based and recomputed each frame in the pipe, not from the
 * per-mesh key.
 *
 * Attachments (colour + writable depth) match `OpaqueRenderPass`; per-material `depthMask` (set
 * by `alphaMode`) decides whether individual draws actually write depth, so blended fragments
 * don't lock in occlusion.
 * @internal
 */
export class TransparentRenderPass extends ForwardRenderPass {
  constructor(options: TransparentRenderPassOptions) {
    super({
      renderer: options.renderer,
      name: 'transparent',
      description: 'Draws distance-sorted transparent scene geometry after opaque and refractive content.',
      bit: RenderPassBit.TRANSPARENT,
      sort: 'distance',
      camera: options.camera,
    });
  }
}
