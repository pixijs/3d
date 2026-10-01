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
 * Draws alpha-blended materials that don't refract, such as smoke, particles and alpha sprites,
 * back to front from the camera, re-sorted every frame
 *
 * Blended materials that refract, such as water, go to `BlendedRefractionPass` instead. The pass
 * declares a writable depth like the opaque pass, but an `alphaMode` of `'blend'` turns the
 * material's depth writes off, so a blended fragment doesn't hide what is drawn behind it later.
 * One class serves both backends through the `View3DPipe` interface.
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
