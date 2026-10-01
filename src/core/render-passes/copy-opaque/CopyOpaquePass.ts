import { RendererType } from 'pixi.js';
import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
import { warnOnce } from '../../../utils/warnOnce';
import type { PassBuilder } from '../../render-graph/PassBuilder';
import type { ColorHandle } from '../../render-graph/ResourceHandle';
import { RenderPass, RenderPassBit } from '../RenderPass';
import type { RenderSession } from '../RenderSession';

/**
 * Options for constructing a {@link CopyOpaquePass}
 * @category rendering
 * @advanced
 */
export interface CopyOpaquePassOptions {
  /** Renderer the pass copies with: the {@link PassContext#renderer} a {@link Pass3D#build} call receives */
  renderer: WebGLRenderer | WebGPURenderer;
  /**
   * Camera whose picture is copied
   *
   * Omitted, the pass copies the view's own picture: the scene colour. Given one, it copies that
   * camera's colour target, the one its passes draw into. See {@link RenderPassOptions#camera}.
   */
  camera?: Camera3D;
  /**
   * Colour texture the copy lands in
   *
   * Required. Hand the same handle to the passes that sample the copy, such as
   * {@link TransmissionRenderPass}. The view camera's copy is {@link PassContext#opaqueColor}. A
   * pass copying another camera allocates its own with {@link RenderGraph#createColor}, passing
   * `autoGenerateMipmaps: true`: the graph then builds its mip levels right after the copy, and
   * rough glass samples the blurred ones.
   */
  opaqueColorHandle: ColorHandle;
}

/**
 * Copies a camera's opaque picture into a texture the glass passes sample
 *
 * Glass can't sample the target it draws into, so transmissive and blended-refractive materials
 * refract a copy taken after the opaque draw. The pass reads its camera's colour target, or the
 * scene colour when it has no camera, and writes {@link CopyOpaquePass#opaqueColorHandle}. It
 * declares no attachments, so the graph binds no target for it, and it copies its camera's
 * target whatever is bound.
 *
 * Add it after the draws it copies and before the passes that sample the copy; passes on other
 * targets can run in between. The default graph runs one for the view's camera after the opaque
 * draw, the `'afterOpaque'` passes and {@link CopyDepthPass}, and before
 * {@link TransmissionRenderPass}. The graph drops it on frames where no running pass samples the
 * copy.
 *
 * On WebGL, the first copy of the view's picture logs a warning when the renderer's
 * `useBackBuffer` is off. A view drawing straight to the canvas without the back buffer gets an
 * empty copy, so its glass refracts neither the 2D content behind the view nor the view's own 3D.
 * @category rendering
 * @advanced
 */
export class CopyOpaquePass extends RenderPass {
  /** Colour texture the copy lands in, as given in {@link CopyOpaquePassOptions#opaqueColorHandle} */
  public readonly opaqueColorHandle: ColorHandle;

  /** Set by the first copy of the view's picture, so the back-buffer check runs once */
  private _backBufferWarned = false;

  constructor(options: CopyOpaquePassOptions) {
    super({
      renderer: options.renderer,
      name: 'copyOpaque',
      description: 'Copies opaque color for transmission and refraction passes to sample.',
      bit: RenderPassBit.NONE,
      camera: options.camera,
    });
    this.opaqueColorHandle = options.opaqueColorHandle;
  }

  /**
   * Declares a read of its camera's colour target and the copy it produces
   *
   * The read orders the copy after whatever drew the target, and keeps a pooled target alive
   * until the copy has run.
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.read(b.targetColor);
    b.produce(this.opaqueColorHandle);
  }

  /**
   * Copies its camera's colour target into {@link CopyOpaquePass#opaqueColorHandle}
   *
   * The first copy of the view's picture warns first on WebGL with `useBackBuffer` off.
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    if (!this.camera && !this._backBufferWarned) {
      this._backBufferWarned = true;
      const renderer = this.pipe.renderer;
      if (renderer.type === RendererType.WEBGL && !(renderer as WebGLRenderer).backBuffer.useBackBuffer) {
        warnOnce(
          `pixi3d-copy-opaque-backbuffer-${renderer.uid}`,
          '[pixi-3d] A transmissive (glass) material is rendering with useBackBuffer off — ' +
            "refraction can't sample 2D content drawn behind the View3D (only the view's own 3D). " +
            'If your glass refracts the page behind it, enable useBackBuffer in Application/renderer init.',
        );
      }
    }

    const graph = session.view3d._graph;
    this.pipe.copyColor(
      graph._drawTarget(this.camera, session),
      graph._texture(this.opaqueColorHandle, session),
      session,
    );
  }
}
