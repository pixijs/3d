import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import type { SceneOutput } from '../../render-graph/SceneOutput';
import { ForwardRenderPass } from '../ForwardRenderPass';
import { RenderPassBit } from '../RenderPass';

interface TransparentRenderPassOptions {
  renderer: WebGLRenderer | WebGPURenderer;
  camera?: Camera3D;
  attachedOutputs?: readonly SceneOutput[];
}

/** @internal */
export class TransparentRenderPass extends ForwardRenderPass {
  constructor(options: TransparentRenderPassOptions) {
    super({
      renderer: options.renderer,
      name: 'transparent',
      description: 'Draws distance-sorted transparent scene geometry after opaque and refractive content.',
      bit: RenderPassBit.TRANSPARENT,
      sort: 'distance',
      camera: options.camera,
      attachedOutputs: options.attachedOutputs,
    });
  }
}
