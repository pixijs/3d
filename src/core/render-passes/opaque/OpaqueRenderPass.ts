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
 * Draws opaque and alpha-tested materials in key order, writing colour and depth
 *
 * A {@link ForwardRenderPass} with `sort: 'key'`, so each pipe can reuse its draw work between
 * frames. It programs against the `View3DPipe` interface only, so importing it pulls in no
 * `core/gpu/**` or `core/gl/**` code.
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
