import type { Camera3D } from '../../scene/cameras/Camera3D';
import type { RenderGraph } from './RenderGraph';
import type { ColorHandle, DepthHandle, ResourceHandle, TransientTextureOptions } from './ResourceHandle';

/**
 * How a pass touches a resource
 *
 * Drives dependency inference and hazard checks.
 *
 *  - `write_attachment` — render-target colour/depth write.
 *  - `read_attachment` — render-target depth attached read-only.
 *  - `sample` — bound to a shader sampler at `slot`.
 *  - `read` — consumed by a non-sampler GPU mechanism (blit / copyToTexture).
 *  - `produce` — written via a non-attachment mechanism (blit, internal multi-target loop).
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
  /** The resource being accessed */
  handle: ResourceHandle;
  /** How the pass touches it */
  mode: AccessMode;
  /** Bind-group slot; always set for `mode === 'sample'`, never for any other mode */
  slot?: number;
}

/**
 * A pass and the accesses it declared during `setup()`
 *
 * Built by the graph as it walks addPass calls.
 * @internal
 */
export interface PassRecord {
  /** Accesses recorded during `setup()`, in declaration order */
  accesses: ResourceAccess[];
}

/**
 * Recording API handed to {@link GraphRenderPass#setup}
 *
 * The graph keeps one and scopes it to each pass's `setup` call, so every access lands on the pass
 * that declared it. Methods return their input handle so callers can capture it inline, as in
 * `const color = b.writeColor(b.targetColor)`.
 * @category rendering
 * @advanced
 */
export class PassBuilder {
  private _current: PassRecord | null = null;
  private _targetColor!: ColorHandle;
  private _targetDepth!: DepthHandle;

  constructor(private readonly _graph: RenderGraph) {}

  /**
   * Colour this pass draws into
   *
   * For a pass whose camera has a render texture, that camera's own target, which the graph copies
   * into the texture. Otherwise the scene colour: the screen in direct mode, a pooled transient in
   * composite mode. Passes that present the scene rather than draw it write
   * {@link PassBuilder#defaultColor} instead.
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

  /** The View's default (screen) colour attachment */
  public get defaultColor(): ColorHandle {
    return this._graph.defaultColor;
  }

  /** The View's default (screen) depth attachment */
  public get defaultDepth(): DepthHandle {
    return this._graph.defaultDepth;
  }

  /**
   * Declare a render-target colour write
   *
   * The graph clears the texture before its first writer each frame when the graph owns it, and
   * keeps what is there otherwise. Later writers always draw over earlier ones.
   *
   * A pass's render target is exactly the set of attachments it declares, so to draw into this
   * pass's target declare both `writeColor(b.targetColor)` and `writeDepth(b.targetDepth)`. A
   * colour-only declaration resolves to a separate colour-only target. Over the screen that is a
   * second target around the canvas rather than pixi's own, and inside a 2D filter it loses the
   * view's place on the filter's texture.
   * @param handle - The colour resource this pass writes as an attachment.
   * @returns The same handle, for inline capture.
   */
  public writeColor(handle: ColorHandle): ColorHandle {
    const record = this._mustBeInSetup('writeColor');
    record.accesses.push({ handle, mode: 'write_attachment' });
    return handle;
  }

  /**
   * Declare a render-target depth write — see {@link PassBuilder#writeColor}
   * @param handle - The depth resource this pass writes as an attachment.
   * @returns The same handle, for inline capture.
   */
  public writeDepth(handle: DepthHandle): DepthHandle {
    const record = this._mustBeInSetup('writeDepth');
    record.accesses.push({ handle, mode: 'write_attachment' });
    return handle;
  }

  /**
   * Declare that this pass produces `handle` without writing it as an attachment
   *
   * For a copy, a pass that binds its own targets in a loop (the shadow pass), or a compute
   * dispatch. The graph orders, keeps and allocates `handle` as for
   * {@link PassBuilder#writeColor}, but binds no target: the pass does its own GPU work.
   * @param handle - The resource this pass produces.
   * @returns The same handle, for inline capture.
   */
  public produce<H extends ResourceHandle>(handle: H): H {
    const record = this._mustBeInSetup('produce');
    record.accesses.push({ handle, mode: 'produce' });
    return handle;
  }

  /**
   * Declare a read-only depth attachment — the pass depth-tests against `handle` without
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
   * Declare that this pass samples `handle` through a shader binding
   *
   * The graph puts the texture in the view's global bind group at `slot` before the pass renders.
   * @param handle - The resource this pass samples.
   * @param slot - Global-bind-group slot the texture is bound to.
   * @returns The same handle, for inline capture.
   */
  public sample<H extends ResourceHandle>(handle: H, slot: number): H {
    const record = this._mustBeInSetup('sample');
    record.accesses.push({ handle, mode: 'sample', slot });
    return handle;
  }

  /**
   * Declare a read without a shader binding
   *
   * For a copy, or a pass that builds its own `TextureView`. The pass runs after the texture's
   * writers, as with {@link PassBuilder#sample}, but the graph binds nothing.
   * @param handle - The resource this pass reads.
   * @returns The same handle, for inline capture.
   */
  public read<H extends ResourceHandle>(handle: H): H {
    const record = this._mustBeInSetup('read');
    record.accesses.push({ handle, mode: 'read' });
    return handle;
  }

  /**
   * Register a graph-allocated colour texture; see {@link RenderGraph#createColor}
   * @param options - Size, resolution, format and label — see {@link TransientTextureOptions}.
   * @returns The handle for the new transient colour resource.
   */
  public createColor(options: TransientTextureOptions = {}): ColorHandle {
    this._mustBeInSetup('createColor');
    return this._graph.createColor(options);
  }

  /**
   * Register a graph-allocated depth texture — see {@link PassBuilder#createColor}
   * @param options - Size, resolution, format and label — see {@link TransientTextureOptions}.
   * @returns The handle for the new transient depth resource.
   */
  public createDepth(options: TransientTextureOptions = {}): DepthHandle {
    this._mustBeInSetup('createDepth');
    return this._graph.createDepth(options);
  }

  /**
   * Starts collecting declared accesses into `record` until `_endPass`; `RenderGraph.addPass`
   * calls the pair around each `setup`
   *
   * Seeds {@link PassBuilder#targetColor} / {@link PassBuilder#targetDepth} from `camera`:
   * that camera's own target, or the scene pair when it has no render texture.
   * @param record - The pass whose `setup()` is about to run
   * @param camera - The pass's camera, or `null` to draw the view.
   * @internal
   */
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

  /**
   * The record `setup()` is currently filling
   * @param label - Which builder member was called, for the error.
   * @returns The current pass's record.
   * @throws When no pass's `setup()` is running.
   */
  private _mustBeInSetup(label: string): PassRecord {
    if (!this._current) {
      throw new Error(`PassBuilder.${label}: called outside a pass.setup()`);
    }
    return this._current;
  }
}
