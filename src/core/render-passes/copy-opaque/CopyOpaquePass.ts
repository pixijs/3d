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
  /** Camera whose picture is copied, or the view's own when omitted; see {@link RenderPassOptions#camera} */
  camera?: Camera3D;
  /**
   * Colour texture the copy lands in; hand the same handle to the passes that sample it
   *
   * For another camera, create it with {@link RenderGraph#createColor} and `autoGenerateMipmaps: true`,
   * or rough glass refracts it unblurred.
   */
  opaqueColorHandle: ColorHandle;
}

/**
 * Copies a camera's opaque picture into a texture for glass to sample
 *
 * Glass can't sample the target it draws into, so transmissive and blended refractive materials
 * refract a copy taken after the opaque draw. {@link createDefaultGraph3D} copies the view's camera
 * into {@link PassContext#opaqueColor}. For another camera, add one after the draws it copies and
 * before the passes that sample it; passes on other targets can run in between. The graph skips the
 * copy on frames where nothing samples it.
 *
 * On WebGL, give the renderer `useBackBuffer: true` when a view draws glass. Without it, a view
 * drawn straight to an opaque canvas (the default `backgroundAlpha: 1`) gets an empty copy, so its
 * glass refracts nothing. The pass warns once when it copies the view's picture with the setting off.
 * @category rendering
 * @advanced
 */
export class CopyOpaquePass extends RenderPass {
  /** Colour texture the copy lands in, as given in {@link CopyOpaquePassOptions#opaqueColorHandle} */
  public readonly opaqueColorHandle: ColorHandle;

  /** Set by the first copy of the view's picture, so later frames skip the check and build no warning key */
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
   * Reads its camera's colour target and produces {@link CopyOpaquePass#opaqueColorHandle}
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.read(b.targetColor);
    b.produce(this.opaqueColorHandle);
  }

  /**
   * Copies its camera's colour target into {@link CopyOpaquePass#opaqueColorHandle}
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    if (!this.camera && !this._backBufferWarned) {
      this._backBufferWarned = true;
      const renderer = this.pipe.renderer;
      if (renderer.type === RendererType.WEBGL && !(renderer as WebGLRenderer).backBuffer.useBackBuffer) {
        warnOnce(
          `pixi3d-copy-opaque-backbuffer-${renderer.uid}`,
          '[pixi-3d] Glass is drawing with useBackBuffer off, so a View3D drawn straight to an opaque canvas ' +
            'refracts nothing. Pass useBackBuffer: true when you create the Application or renderer.',
        );
      }
    }

    const graph = session.view3d._graph;
    this.pipe.copyColor(
      graph._drawTarget(this.camera, session),
      graph.getTexture(this.opaqueColorHandle, session),
      session,
    );
  }
}
