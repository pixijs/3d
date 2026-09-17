import { RendererType, warn } from 'pixi.js';
import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

import type { Camera3D } from '../../../scene/cameras/Camera3D';
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
 * declares no attachments, so the graph binds no target for it.
 *
 * It copies whichever target is bound when it runs: add it straight after the draws it copies,
 * with no pass on another target in between. The default graph runs one for the view's camera
 * after the opaque draw, the `'afterOpaque'` passes and {@link CopyDepthPass}, and before
 * {@link TransmissionRenderPass}. The graph drops it on frames where no running pass samples the
 * copy.
 *
 * On WebGL, copying the view's picture while the renderer's `useBackBuffer` is off logs a warning:
 * the copy can't include 2D content drawn behind the view, so glass can't refract it.
 * @category rendering
 * @advanced
 */
export class CopyOpaquePass extends RenderPass {
  /** Colour texture the copy lands in, as given in {@link CopyOpaquePassOptions#opaqueColorHandle} */
  public readonly opaqueColorHandle: ColorHandle;

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
   * Copies the bound colour target into {@link CopyOpaquePass#opaqueColorHandle}
   *
   * Warns first when it copies the view's picture on WebGL with `useBackBuffer` off.
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    // This pass runs only when a transmissive material is on screen — the graph culls it
    // otherwise (TransmissionRenderPass.condition) — so it is the choke point for "glass is
    // active". Without the back buffer the copy can't include 2D content drawn behind the
    // View3D, so refraction of the page behind it silently fails. (Glass that only refracts
    // other 3D inside the view works either way, so this can over-warn for that case.)
    if (!this.camera) {
      const renderer = this.pipe.renderer;
      if (renderer.type === RendererType.WEBGL && !(renderer as WebGLRenderer).backBuffer.useBackBuffer) {
        warn(
          '[pixi-3d] A transmissive (glass) material is rendering with useBackBuffer off — ' +
            "refraction can't sample 2D content drawn behind the View3D (only the view's own 3D). " +
            'If your glass refracts the page behind it, enable useBackBuffer in Application/renderer init.',
        );
      }
    }

    this.pipe.copyColor(this.opaqueColorHandle, session);
  }
}
