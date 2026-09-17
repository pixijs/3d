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
  /**
   * Camera to draw from
   *
   * Omitted, the pass draws from the view's own camera into the view. Given one, it culls and
   * draws from that camera into that camera's target, and the copies it samples have to come
   * from a {@link CopyOpaquePass} and a {@link CopyDepthPass} on the same camera. See
   * {@link RenderPassOptions#camera}.
   */
  camera?: Camera3D;
  /**
   * Opaque colour copy the materials refract
   *
   * Required. The handle a {@link CopyOpaquePass} earlier in the graph writes:
   * {@link PassContext#opaqueColor} for the view's own camera.
   */
  opaqueColorHandle: ColorHandle;
  /**
   * Opaque depth copy the materials read the depth beneath them from
   *
   * Required. The handle a {@link CopyDepthPass} earlier in the graph writes:
   * {@link PassContext#opaqueDepth} for the view's own camera.
   */
  opaqueDepthHandle: DepthHandle;
}

/**
 * Draws blended refractive materials, such as water, over copies of the opaque colour and depth
 *
 * Takes the meshes in the `BLENDED_REFRACTION` membership of {@link RenderPassBit}. They sample
 * both copies: the colour to refract, and the depth for effects that change with the distance to
 * what lies beneath, such as a shoreline or refraction that fades with depth. So a
 * {@link CopyOpaquePass} and a {@link CopyDepthPass} on the same camera have to run earlier in the
 * graph.
 *
 * Draws are sorted back to front by distance from the camera, every frame. The depth target is
 * attached read-only, so the draws test against the opaque scene's depth. The default
 * graph runs one for the view's camera after {@link TransmissionRenderPass} and before the
 * transparent draw. The graph skips it on frames with no such mesh in the view's scene.
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
   * Declares a colour write and a read-only depth attachment on its camera's target, and samples of
   * both opaque copies
   *
   * The read-only depth lets the draws test against the opaque scene. The samples bind the copies
   * for the shaders and keep their copy passes in the frame.
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.writeColor(b.targetColor);
    b.readDepthAttachment(b.targetDepth);
    b.sample(this.opaqueColorHandle, this.pipe.globalSlots.opaqueColor);
    b.sample(this.opaqueDepthHandle, this.pipe.globalSlots.opaqueDepth);
  }
}
