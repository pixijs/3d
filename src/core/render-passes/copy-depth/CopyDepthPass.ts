import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { DepthHandle } from '../../render-graph/ResourceHandle';
import { RenderPass, RenderPassBit } from '../RenderPass';
import type { RenderSession } from '../RenderSession';

/**
 * Options for constructing a {@link CopyDepthPass}
 * @category rendering
 * @advanced
 */
export interface CopyDepthPassOptions {
  /** Renderer the pass copies with: the {@link PassContext#renderer} a {@link Pass3D#build} call receives */
  renderer: WebGLRenderer | WebGPURenderer;
  /** Camera whose depth is copied, or the view's own when omitted; see {@link RenderPassOptions#camera} */
  camera?: Camera3D;
  /**
   * Depth texture the copy lands in; hand the same handle to the passes that sample it
   *
   * For another camera, create it with {@link RenderGraph#createDepth}.
   */
  opaqueDepthHandle: DepthHandle;
}

/**
 * Copies a camera's opaque depth into a texture for refractive materials to sample
 *
 * Effects that read the depth beneath them, such as a water shoreline or refraction that fades with
 * depth, draw over the opaque scene and so sample a copy of its depth. {@link createDefaultGraph3D}
 * copies the view's camera into {@link PassContext#opaqueDepth}. For another camera, add one after
 * the draws it copies and before the passes that sample it; passes on other targets can run in
 * between.
 *
 * The graph skips the copy on frames where nothing samples it. {@link BlendedRefractionPass} does,
 * but {@link TransmissionRenderPass} doesn't, so glass alone costs no depth copy.
 * @category rendering
 * @advanced
 */
export class CopyDepthPass extends RenderPass {
  /** Depth texture the copy lands in, as given in {@link CopyDepthPassOptions#opaqueDepthHandle} */
  public readonly opaqueDepthHandle: DepthHandle;

  constructor(options: CopyDepthPassOptions) {
    super({
      renderer: options.renderer,
      name: 'copyDepth',
      description: 'Copies opaque depth into a texture for later screen-space sampling.',
      bit: RenderPassBit.NONE,
      camera: options.camera,
    });
    this.opaqueDepthHandle = options.opaqueDepthHandle;
  }

  /**
   * Reads its camera's depth target and produces {@link CopyDepthPass#opaqueDepthHandle}
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.read(b.targetDepth);
    b.produce(this.opaqueDepthHandle);
  }

  /**
   * Copies its camera's depth target into {@link CopyDepthPass#opaqueDepthHandle}
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    const graph = session.view3d._graph;
    this.pipe.copyDepth(
      graph._drawTarget(this.camera, session),
      graph.getTexture(this.opaqueDepthHandle, session),
      session,
    );
  }
}
