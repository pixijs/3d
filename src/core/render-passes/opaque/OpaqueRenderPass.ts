import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import { ForwardRenderPass } from '../ForwardRenderPass';
import { RenderPassBit } from '../RenderPass';

/**
 * Options for constructing an {@link OpaqueRenderPass}
 * @internal
 */
interface OpaqueRenderPassOptions {
  /** The renderer this pass will draw with */
  renderer: WebGLRenderer | WebGPURenderer;
  /** Camera to draw from; omitted, the view's own camera is used */
  camera?: Camera3D;
}

/**
 * Opaque 3D mesh pass — one class for both backends
 *
 * It programs against the `View3DPipe` interface only, so importing it pulls in **no**
 * `core/gpu/**` or `core/gl/**` runtime code. The draw is expressed declaratively via
 * {@link ForwardRenderPass} with `sort: 'key'` (stable batch-key order, cacheable).
 * The pipe translates that into its own mechanism — a cached WebGPU render bundle or a
 * WebGL persistent instance buffer.
 *
 * Per-dirty-mesh keying is inherited from `RenderPass.onRenderableDirty` (the
 * primary-material path, via `pipe.renderer.material3d.computeBatchKey`). Attachments
 * (colour + writable depth) and the empty-bit cull come from {@link ForwardRenderPass}.
 * @internal
 */
export class OpaqueRenderPass extends ForwardRenderPass {
  constructor(options: OpaqueRenderPassOptions) {
    super({
      renderer: options.renderer,
      name: 'opaque',
      description: 'Draws opaque scene geometry into scene color and depth.',
      bit: RenderPassBit.OPAQUE,
      sort: 'key',
      camera: options.camera,
    });
  }
}
