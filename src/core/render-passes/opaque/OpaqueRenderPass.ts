import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import type { SceneOutput } from '../../render-graph/SceneOutput';
import { ForwardRenderPass } from '../ForwardRenderPass';
import { RenderPassBit } from '../RenderPass';

interface OpaqueRenderPassOptions {
  renderer: WebGLRenderer | WebGPURenderer;
  camera?: Camera3D;
  attachedOutputs?: readonly SceneOutput[];
}

/** @internal */
export class OpaqueRenderPass extends ForwardRenderPass {
  constructor(options: OpaqueRenderPassOptions) {
    super({
      renderer: options.renderer,
      name: 'opaque',
      description: 'Draws opaque scene geometry into scene color and depth.',
      bit: RenderPassBit.OPAQUE,
      sort: 'key',
      camera: options.camera,
      attachedOutputs: options.attachedOutputs,
    });
  }
}
