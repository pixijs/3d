import type { PassBuilder } from '../render-graph/PassBuilder';
import { CullResults } from './CullResult';
import type { RenderForwardDescriptor } from './RenderForwardDescriptor';
import { RenderPass } from './RenderPass';
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
   * Whether the backend may reuse recorded draw work across frames where nothing changed
   *
   * Omitted, `'key'` passes cache and `'distance'` passes rebuild every frame. `'auto'` lets the
   * backend cache either way; `'never'` rebuilds every frame.
   */
  cache?: 'auto' | 'never';
  /**
   * Whether the draw packs a texture atlas for the shader to sample
   *
   * Set `false` for solid-colour or depth-only shaders, such as outlines and wireframes.
   * @default true
   */
  textures?: boolean;
}

/**
 * Draws the scene meshes in one pass membership from one camera
 *
 * The engine's forward mesh draw. The default graph's opaque, transparent and glass passes are
 * all forward passes, and a {@link MeshPass} builds one. It draws every mesh whose
 * material belongs to its `name`, whether a built-in membership such as `'opaque'` or a name
 * materials opt into through their `passes` option, with batching, skinning and morph targets on
 * both backends.
 *
 * Construct one in a {@link Pass3D#build} to draw a membership again from another camera, as
 * {@link PortalPass} does for `'opaque'` and `'transparent'`. It writes colour and depth on its
 * camera's target, or the scene's when it has no camera. The graph skips it on frames where no
 * mesh in the view's scene belongs to it; a membership whose meshes are all hidden still runs, and
 * draws nothing. Subclasses that sample the opaque copies, such as
 * {@link TransmissionRenderPass}, override {@link ForwardRenderPass#setup}.
 * @category rendering
 * @advanced
 */
export class ForwardRenderPass extends RenderPass {
  /** Declarative draw description handed to the pipe every frame */
  protected readonly _forward: RenderForwardDescriptor;

  /**
   * WebGPU's per-batch cull results for this pass: the survivors of its frustum, their indirect
   * counts, and the bundle recorded against them
   *
   * The draw list on the batch is shared by every pass on the bit; this is the half the camera
   * decides. Empty on WebGL, which compacts each list in place inside the draw.
   * @internal
   */
  public readonly cullResults = new CullResults();

  constructor(options: ForwardRenderPassOptions) {
    super(options);
    this._forward = {
      bit: this.bit,
      cullResults: this.cullResults,
      camera: this.camera,
      sort: options.sort,
      cache: options.cache,
      textures: options.textures,
    };
    this._updatesViewKey = options.sort === 'key';
  }

  /**
   * Declares colour and depth writes on its camera's target
   *
   * Writes {@link PassBuilder#targetColor} and {@link PassBuilder#targetDepth}. A subclass that
   * also samples a texture, such as an opaque copy, overrides this.
   * @param b - The builder recording this pass's resource accesses
   */
  public override setup(b: PassBuilder): void {
    b.writeColor(b.targetColor);
    b.writeDepth(b.targetDepth);
  }

  /**
   * Skips the frame when no mesh in the view's scene belongs to this pass
   *
   * A skipped pass binds no target and does no sort or draw work, and the graph also drops any
   * copy only it samples. Membership decides, not visibility: a pass whose meshes are all hidden
   * still runs and draws nothing, which keeps the set of running passes, and anything recorded
   * against it, stable.
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
   * Uploads this pass's draw data before any render target is bound
   *
   * The graph has already built this pass's camera, so the cull that follows reads its frustum.
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

  /**
   * Gives back the GPU memory this pass recorded for its draws; the next render rebuilds it
   *
   * Called through {@link RenderGraph#unload}. The draw lists on the batches are the batches' to
   * unload.
   */
  public unload(): void {
    this.cullResults.unload();
  }

  /** Releases what this pass recorded for its draws; the draw lists on the batches stay theirs */
  public override destroy(): void {
    this.cullResults.release();
    super.destroy();
  }
}
