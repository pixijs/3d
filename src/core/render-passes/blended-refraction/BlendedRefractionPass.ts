import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { ColorHandle, DepthHandle } from '../../render-graph/ResourceHandle';
import { ForwardRenderPass } from '../ForwardRenderPass';
import { RenderPassBit } from '../RenderPass';

/**
 * Options for constructing a {@link BlendedRefractionPass}
 * @category rendering
 * @advanced
 */
export interface BlendedRefractionPassOptions {
  /** Renderer the pass draws with: the {@link PassContext#renderer} a {@link Pass3D#build} call receives */
  renderer: WebGLRenderer | WebGPURenderer;
  /** Camera to draw from, or the view's own when omitted; see {@link RenderPassOptions#camera} */
  camera?: Camera3D;
  /**
   * Opaque colour copy the materials refract, from a {@link CopyOpaquePass}: {@link PassContext#opaqueColor}
   * for the view's own camera
   */
  opaqueColorHandle: ColorHandle;
  /**
   * Opaque depth copy the materials read, from a {@link CopyDepthPass}: {@link PassContext#opaqueDepth}
   * for the view's own camera
   */
  opaqueDepthHandle: DepthHandle;
}

/**
 * Draws blended refractive materials, such as water, over copies of the opaque colour and depth
 *
 * Draws the meshes in {@link RenderPassBit.BLENDED_REFRACTION}, back to front from the camera and
 * re-sorted every frame. They test against the scene's depth.
 *
 * A {@link CopyOpaquePass} and a {@link CopyDepthPass} on the same camera must run earlier in the
 * graph. {@link createDefaultGraph3D} adds this pass and both copies for the view's camera.
 * @category rendering
 * @advanced
 */
export class BlendedRefractionPass extends ForwardRenderPass {
  /** Opaque colour copy the materials refract, as given in {@link BlendedRefractionPassOptions#opaqueColorHandle} */
  public readonly opaqueColorHandle: ColorHandle;
  /** Opaque depth copy the materials sample, as given in {@link BlendedRefractionPassOptions#opaqueDepthHandle} */
  public readonly opaqueDepthHandle: DepthHandle;

  constructor(options: BlendedRefractionPassOptions) {
    super({
      renderer: options.renderer,
      name: 'blendedRefraction',
      description: 'Draws distance-sorted refractive materials using opaque color and depth copies.',
      bit: RenderPassBit.BLENDED_REFRACTION,
      sort: 'distance',
      camera: options.camera,
    });
    this.opaqueColorHandle = options.opaqueColorHandle;
    this.opaqueDepthHandle = options.opaqueDepthHandle;
  }

  /**
   * Writes its camera's colour, declares its depth read-only, and samples both opaque copies
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.writeColor(b.targetColor);
    b.readDepthAttachment(b.targetDepth);
    b.sample(this.opaqueColorHandle, b.globalTextureBindings.opaqueColor);
    b.sample(this.opaqueDepthHandle, b.globalTextureBindings.opaqueDepth);
  }
}
