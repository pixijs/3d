import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { RenderGraph } from './RenderGraph';
import type { ColorHandle, DepthHandle, ResourceHandle, TransientTextureOptions } from './ResourceHandle';
import type { SceneOutput } from './SceneOutput';
import type { GlobalTextureBindings, TextureBinding } from './TextureBinding';

/**
 * How a pass uses a texture, as declared with a {@link PassBuilder} method
 *
 * - `write_attachment`: drawn into as a render target, from `writeColor` or `writeDepth`
 * - `read_attachment`: a depth attached read-only, from `readDepthAttachment`
 * - `sample`: bound for a shader to sample, from `sample`
 * - `read`: read some other way, such as a copy, from `read`
 * - `produce`: written some other way, such as a copy or compute work, from `produce`
 * @category rendering
 * @advanced
 */
export type AccessMode = 'write_attachment' | 'read_attachment' | 'sample' | 'read' | 'produce';

/**
 * One resource access declared by a pass during `setup()`
 * @category rendering
 * @advanced
 */
export interface ResourceAccess {
  /** The texture the pass uses */
  handle: ResourceHandle;
  /** How the pass touches it */
  mode: AccessMode;
  /** Where the texture is bound; set only for `'sample'` */
  binding?: TextureBinding;
}

/** @internal */
export interface PassRecord {
  accesses: ResourceAccess[];
  hasSideEffect: boolean;
}

/**
 * Declares what a pass reads and writes; {@link GraphRenderPass#setup} receives one
 *
 * Each declaration returns its handle, so `const color = b.writeColor(b.targetColor)` captures it
 * inline.
 * @category rendering
 * @advanced
 */
export class PassBuilder {
  private _current: PassRecord | null = null;
  private _targetColor!: ColorHandle;
  private _targetDepth!: DepthHandle;

  constructor(private readonly _graph: RenderGraph) {}

  /**
   * The colour this pass draws into: {@link RenderGraph#sceneColor}, or for a pass whose camera has a
   * render texture, that camera's own target
   *
   * A pass that presents the finished picture writes {@link PassBuilder#defaultColor} instead.
   */
  public get targetColor(): ColorHandle {
    this._mustBeInSetup('targetColor');
    return this._targetColor;
  }

  /** Depth paired with {@link PassBuilder#targetColor} */
  public get targetDepth(): DepthHandle {
    this._mustBeInSetup('targetDepth');
    return this._targetDepth;
  }

  /** The colour of the view's own target; see {@link RenderGraph#defaultColor} */
  public get defaultColor(): ColorHandle {
    return this._graph.defaultColor;
  }

  /** Depth paired with {@link PassBuilder#defaultColor} */
  public get defaultDepth(): DepthHandle {
    return this._graph.defaultDepth;
  }

  /**
   * The texture of a scene output the graph attaches, for this pass to write or read; see
   * {@link RenderGraph#getSceneOutput}
   * @param output - An output in the graph's `sceneOutputs`
   * @returns The output's texture handle
   */
  public getSceneOutput(output: SceneOutput): ColorHandle {
    return this._graph.getSceneOutput(output);
  }

  /**
   * Declares that this pass draws into `handle` as a render target
   *
   * The first pass each frame to write a texture the graph allocated clears it, unless that pass
   * writes it with {@link PassBuilder#produce} instead; a texture you import with
   * {@link RenderGraph#importColor} keeps its content. Later writers draw over earlier ones, and a pass that writes several colours
   * attaches them in the order it declares them.
   *
   * A pass's target is exactly the attachments it declares, so to draw into this pass's target,
   * declare both `writeColor(b.targetColor)` and `writeDepth(b.targetDepth)`. Declared alone, the
   * colour gets a target of its own: over the screen that isn't pixi's target, and inside a 2D
   * filter it loses the view's place on the filter's texture.
   * @param handle - The colour resource this pass writes as an attachment.
   * @returns The same handle, for inline capture.
   */
  public writeColor(handle: ColorHandle): ColorHandle {
    const record = this._mustBeInSetup('writeColor');
    record.accesses.push({ handle, mode: 'write_attachment' });
    return handle;
  }

  /**
   * Declares that this pass draws into the depth `handle`; see {@link PassBuilder#writeColor}
   * @param handle - The depth resource this pass writes as an attachment.
   * @returns The same handle, for inline capture.
   */
  public writeDepth(handle: DepthHandle): DepthHandle {
    const record = this._mustBeInSetup('writeDepth');
    record.accesses.push({ handle, mode: 'write_attachment' });
    return handle;
  }

  /**
   * Declares that this pass writes `handle` itself, with a copy, compute work or targets it binds
   *
   * The graph counts `handle` as written, as for {@link PassBuilder#writeColor}, but binds and clears
   * nothing for it; get the texture in `render` with {@link RenderGraph#getTexture}.
   * @param handle - The resource this pass produces.
   * @returns The same handle, for inline capture.
   */
  public produce<H extends ResourceHandle>(handle: H): H {
    const record = this._mustBeInSetup('produce');
    record.accesses.push({ handle, mode: 'produce' });
    return handle;
  }

  /**
   * Declares a read-only depth attachment: the pass depth-tests against `handle` without
   * writing it
   * @param handle - The depth resource attached read-only.
   * @returns The same handle, for inline capture.
   */
  public readDepthAttachment(handle: DepthHandle): DepthHandle {
    const record = this._mustBeInSetup('readDepthAttachment');
    record.accesses.push({ handle, mode: 'read_attachment' });
    return handle;
  }

  /**
   * The view's global texture bindings, to pass to {@link PassBuilder#sample}
   * @example
   * ```ts
   * b.sample(opaqueDepth, b.globalTextureBindings.opaqueDepth);
   * ```
   */
  public get globalTextureBindings(): GlobalTextureBindings {
    return this._graph.globalTextureBindings;
  }

  /**
   * Declares that this pass samples `handle` through `binding`
   *
   * The graph puts the frame's texture in the binding before the pass renders. A texture the graph
   * allocated that another pass attaches as a render target needs a bind group this pass owns;
   * {@link RenderGraph#compile} throws for a global binding.
   * @param handle - The resource this pass samples.
   * @param binding - Where the texture goes.
   * @returns The same handle, for inline capture.
   */
  public sample<H extends ResourceHandle>(handle: H, binding: TextureBinding): H {
    const record = this._mustBeInSetup('sample');
    if (binding.styleSlot !== undefined && handle._kind === 'depth') {
      throw new Error(
        'PassBuilder.sample: a depth handle binds as a depth view, which has no sampler to bind beside it',
      );
    }
    record.accesses.push({ handle, mode: 'sample', binding });
    return handle;
  }

  /**
   * Declares a read the graph doesn't bind, for a copy or a pass that builds its own bindings
   *
   * It keeps the earlier passes that write the texture running; get the texture in `render` with
   * {@link RenderGraph#getTexture}.
   * @param handle - The resource this pass reads.
   * @returns The same handle, for inline capture.
   */
  public read<H extends ResourceHandle>(handle: H): H {
    const record = this._mustBeInSetup('read');
    record.accesses.push({ handle, mode: 'read' });
    return handle;
  }

  /**
   * Keeps this pass running when no other pass reads what it writes, for work that leaves the graph,
   * such as a readback to the CPU
   *
   * The graph runs a pass only when a later pass uses what it writes, or when it writes the screen,
   * an imported texture or a camera's target. A pass that calls this in `setup` runs too, and so do
   * the passes it reads from.
   *
   * It doesn't override the pass's `condition`: on a frame the condition skips this pass, any pass
   * that only feeds it is skipped too. The scene still writes every scene output a pass requires,
   * every frame.
   * @example
   * ```ts
   * graph.addPass({
   *   name: 'pickReadback',
   *   bit: RenderPassBit.NONE,
   *   setup: (b) => {
   *     b.read(objectIds);
   *     b.sideEffect();
   *   },
   *   render: (session) => readPixelUnderPointer(graph.getTexture(objectIds, session)),
   * });
   * ```
   */
  public sideEffect(): void {
    this._mustBeInSetup('sideEffect').hasSideEffect = true;
  }

  /**
   * Creates a colour texture the graph allocates; see {@link RenderGraph#createColor}
   * @param options - Size, resolution, format and label; see {@link TransientTextureOptions}.
   * @returns The handle for the new transient colour resource.
   */
  public createColor(options: TransientTextureOptions = {}): ColorHandle {
    this._mustBeInSetup('createColor');
    return this._graph.createColor(options);
  }

  /**
   * Creates a depth texture the graph allocates; see {@link RenderGraph#createColor}
   * @param options - Size, resolution, format and label; see {@link TransientTextureOptions}.
   * @returns The handle for the new transient depth resource.
   */
  public createDepth(options: TransientTextureOptions = {}): DepthHandle {
    this._mustBeInSetup('createDepth');
    return this._graph.createDepth(options);
  }

  /** @internal */
  public _beginPass(record: PassRecord, camera?: Camera3D | null): void {
    this._current = record;
    if (camera?.renderTexture) {
      const target = this._graph._cameraTarget(camera);
      this._targetColor = target.color;
      this._targetDepth = target.depth;
    } else {
      this._targetColor = this._graph.sceneColor;
      this._targetDepth = this._graph.sceneDepth;
    }
  }

  /** @internal */
  public _endPass(): void {
    this._current = null;
  }

  private _mustBeInSetup(label: string): PassRecord {
    if (!this._current) {
      throw new Error(`PassBuilder.${label}: called outside a pass.setup()`);
    }
    return this._current;
  }
}
