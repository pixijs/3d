import type { PassBuilder } from '../render-graph/PassBuilder';
import { CullResults } from './CullResults';
import type { RenderForwardDescriptor } from './RenderForwardDescriptor';
import { RenderPass, RenderPassBit } from './RenderPass';
import type { RenderPassOptions } from './RenderPass';
import type { RenderSession } from './RenderSession';

/**
 * Options for constructing a {@link ForwardRenderPass}
 * @category rendering
 * @advanced
 */
export interface ForwardRenderPassOptions extends RenderPassOptions {
  /**
   * Draw order
   *
   * - `'key'`: stable batch and pipeline order, so the draw work can be cached between frames.
   *   Right for opaque surfaces.
   * - `'distance'`: back to front by distance from the camera, re-sorted every frame. Right for
   *   alpha blending.
   */
  sort: 'key' | 'distance';
  /**
   * Whether the pass may reuse its draws across frames where nothing changed
   *
   * Defaults to `'auto'` on a `'key'` pass, where `'never'` makes it rebuild its draws every frame,
   * and to `'never'` on a `'distance'` pass. Leave it out there: `'auto'` makes WebGPU draw a
   * `'distance'` pass in key order, not back to front.
   */
  cache?: 'auto' | 'never';
}

/**
 * Draws the scene meshes in one pass membership from one camera
 *
 * The default graph's opaque, transparent and glass passes are forward passes, and a
 * {@link MeshPass} builds one. It draws every mesh whose material belongs to its `name`, a
 * built-in membership such as `'opaque'` or a name materials join through their `passes` option.
 *
 * Construct one in a {@link Pass3D#build} to draw a membership again from another camera, as
 * {@link PortalPass} does for `'opaque'` and `'transparent'`. It writes colour and depth on its
 * camera's target, or the scene's when it has no camera.
 * @category rendering
 * @advanced
 */
export class ForwardRenderPass extends RenderPass {
  /** Declarative draw description handed to the pipe every frame */
  protected readonly _forward: RenderForwardDescriptor;

  /** @internal */
  public readonly cullResults = new CullResults();

  constructor(options: ForwardRenderPassOptions) {
    super(options);
    this._forward = {
      bit: this.bit,
      bindsMaterial: !this.descriptor?.shaderDescriptor && (this.bit & RenderPassBit.MATERIAL_PASS_MASK) !== 0,
      cullResults: this.cullResults,
      camera: this.camera,
      sort: options.sort,
      cache: options.cache,
    };
    this._updatesViewKey = options.sort === 'key';
  }

  /**
   * Declares writes of its camera's target colour, attached outputs and depth; a subclass that also
   * samples a texture, such as an opaque copy, overrides it
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    this._writeTarget(b);
  }

  /**
   * Skips the frame when no mesh in the view's scene belongs to this pass
   *
   * Membership decides, not visibility: a pass whose meshes are all hidden still runs and draws
   * nothing.
   * @param session - The current frame's render session
   * @returns Whether the pass should run this frame
   */
  public override condition(session: RenderSession): boolean {
    const batches = session.view3d._meshBatches;
    for (let i = 0; i < batches.length; i++) {
      const pd = batches[i].drawLists[this.bit];
      if (pd && pd.view.count > 0) return true;
    }
    return false;
  }

  /**
   * Builds and culls this pass's draws before any render target is bound, on WebGPU with `cache: 'auto'`
   * @param session - The current frame's render session
   */
  public override prepare(session: RenderSession): void {
    this.pipe.prepareForward(this._forward, session);
  }

  /**
   * Draws this pass's meshes from its camera
   * @param session - The current frame's render session
   */
  public override render(session: RenderSession): void {
    this.pipe.renderForward(this._forward, session);
  }

  /** Gives back the GPU memory this pass recorded for its draws; the next render rebuilds it */
  public unload(): void {
    this.cullResults.unload();
  }

  /** Releases what this pass recorded for its draws */
  public override destroy(): void {
    this.cullResults.release();
    super.destroy();
  }
}
