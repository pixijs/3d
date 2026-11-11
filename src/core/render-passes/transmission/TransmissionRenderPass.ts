import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { ColorHandle } from '../../render-graph/ResourceHandle';
import type { SceneOutput } from '../../render-graph/SceneOutput';
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
  /** Camera to draw from, or the view's own when omitted; see {@link RenderPassOptions#camera} */
  camera?: Camera3D;
  /**
   * Opaque colour copy the glass refracts, from a {@link CopyOpaquePass}: {@link PassContext#opaqueColor}
   * for the view's own camera
   */
  opaqueColorHandle: ColorHandle;
  /** The scene outputs attached after the target colour; see {@link RenderPassOptions#attachedOutputs} */
  attachedOutputs?: readonly SceneOutput[];
}

/**
 * Draws transmissive (glass) materials over a copy of the opaque picture behind them
 *
 * Draws the meshes whose material sets {@link Material3DOptions#transmission}. Each fragment
 * refracts the opaque colour copy, rough glass through the copy's blurred mip levels, so a
 * {@link CopyOpaquePass} on the same camera must run earlier in the graph.
 * {@link createDefaultGraph3D} adds this pass and its copy for the view's camera.
 *
 * The copy is taken before any glass draws, so glass behind glass doesn't show through it. Glass
 * writes depth by default, so it hides particles and anything else drawn behind it later. A frame
 * with no glass in the scene skips the copy, unless something else samples it.
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
      attachedOutputs: options.attachedOutputs,
    });
    this.opaqueColorHandle = options.opaqueColorHandle;
  }

  /**
   * Writes its camera's colour and depth, and samples the opaque colour copy
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    super.setup(b);
    b.sample(this.opaqueColorHandle, b.globalTextureBindings.opaqueColor);
  }
}
