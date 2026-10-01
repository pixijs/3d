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
  /**
   * Camera whose depth is copied
   *
   * Omitted, the pass copies the view's own depth: the scene depth. Given one, it copies that
   * camera's depth target, the one its passes draw into. See {@link RenderPassOptions#camera}.
   */
  camera?: Camera3D;
  /**
   * Depth texture the copy lands in
   *
   * Required. Hand the same handle to the passes that sample the copy, such as
   * {@link BlendedRefractionPass}. The view camera's copy is {@link PassContext#opaqueDepth}; a
   * pass copying another camera allocates its own with {@link RenderGraph#createDepth}.
   */
  opaqueDepthHandle: DepthHandle;
}

/**
 * Copies a camera's opaque depth into a texture that refractive materials sample
 *
 * Effects that read the depth of what lies beneath them, such as a water shoreline or refraction
 * that fades with depth, draw over the opaque scene and so sample a copy of its depth. The pass
 * reads its camera's depth target, or the scene depth when it has no camera, and writes
 * {@link CopyDepthPass#opaqueDepthHandle}. It declares no attachments, so the graph binds no
 * target for it, and it copies its camera's target whatever is bound.
 *
 * Add it after the draws it copies and before the passes that sample the copy; passes on other
 * targets can run in between. The default graph runs one for the view's camera after the opaque
 * draw and the `'afterOpaque'` passes, just before {@link CopyOpaquePass}. The graph drops it on
 * frames where no running pass samples the copy. {@link BlendedRefractionPass} samples it;
 * {@link TransmissionRenderPass} doesn't, so a scene with only glass skips it.
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
   * Declares a read of its camera's depth target and the copy it produces
   *
   * The read orders the copy after whatever drew the target, and keeps a pooled target alive
   * until the copy has run.
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
      graph._texture(this.opaqueDepthHandle, session),
      session,
    );
  }
}
