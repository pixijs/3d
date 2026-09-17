import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { ColorHandle } from '../../render-graph/ResourceHandle';
import { ForwardRenderPass } from '../ForwardRenderPass';
import { RenderPassBit } from '../RenderPass';

/**
 * Options for constructing a {@link TransmissionRenderPass}
 * @category rendering
 * @advanced
 */
export interface TransmissionRenderPassOptions {
  /** Renderer the pass draws with: the {@link PassContext#renderer} a {@link Pass3D#build} call receives */
  renderer: WebGLRenderer | WebGPURenderer;
  /**
   * Camera to draw from
   *
   * Omitted, the pass draws from the view's own camera into the view. Given one, it culls and
   * draws from that camera into that camera's target, and the copy it samples has to come from a
   * {@link CopyOpaquePass} on the same camera. See {@link RenderPassOptions#camera}.
   */
  camera?: Camera3D;
  /**
   * Opaque colour copy the glass refracts
   *
   * Required. The handle a {@link CopyOpaquePass} earlier in the graph writes:
   * {@link PassContext#opaqueColor} for the view's own camera.
   */
  opaqueColorHandle: ColorHandle;
}

/**
 * Draws transmissive (glass) materials over a copy of the opaque picture behind them
 *
 * Takes the meshes whose material has {@link Material3DOptions#transmission} set and draws them
 * from its camera. Each fragment refracts the opaque colour copy, reading blurred mip levels for
 * rough glass, so a {@link CopyOpaquePass} on the same camera has to run earlier in the graph.
 * The copy is taken before any glass draws, so glass seen through glass doesn't show.
 *
 * Transmission happens in the shader, not through blending, so the pass draws in stable material
 * order, caches its draw work, and writes depth: overlapping glass occludes correctly. The default
 * graph runs one for the view's camera after {@link CopyOpaquePass}, before
 * {@link BlendedRefractionPass} and the transparent draw. The graph skips it on frames with no
 * glass in the view's scene, and then drops the copy too unless something else samples it.
 * @category rendering
 * @advanced
 */
export class TransmissionRenderPass extends ForwardRenderPass {
  /** Opaque colour copy the glass refracts, as given in {@link TransmissionRenderPassOptions#opaqueColorHandle} */
  public readonly opaqueColorHandle: ColorHandle;

  constructor(options: TransmissionRenderPassOptions) {
    super({
      renderer: options.renderer,
      name: 'transmission',
      description: 'Draws transmissive materials using the opaque scene color behind them.',
      bit: RenderPassBit.TRANSMISSION,
      sort: 'key',
      camera: options.camera,
    });
    this.opaqueColorHandle = options.opaqueColorHandle;
  }

  /**
   * Declares colour and depth writes on its camera's target, and a sample of the opaque colour copy
   *
   * The sample binds the copy for the glass shaders and keeps its {@link CopyOpaquePass} in the frame.
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    super.setup(b);
    b.sample(this.opaqueColorHandle, this.pipe.globalSlots.opaqueColor);
  }
}
