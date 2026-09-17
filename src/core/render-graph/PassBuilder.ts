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
 * Recording API handed to `RenderPass.setup`
 *
 * One instance lives on the graph; `_beginPass` / `_endPass` scope each setup call so accesses
 * are attributed to the right pass. Methods return their input handle so
 * callers can capture it inline, e.g. `const c = b.writeColor(b.targetColor)`.
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
   * The camera's render texture when this pass has one, else the scene colour — the screen in
   * direct mode, a pooled transient in composite mode. Seeded at the start of `setup()`. Passes
   * that present rather than draw the scene write {@link PassBuilder#defaultColor} instead.
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

  // --- Recording API ---

  /**
   * Declare a render-target colour write
   *
   * Load vs clear is inferred from writer order and resource kind — see
   * `RenderGraph._effectiveLoadOp`.
   *
   * A pass's render target is exactly its set of attachment declarations — the
   * executor resolves them to one `RenderTarget`, cache-keyed by the attachment
   * textures. To draw into this pass's target, declare BOTH `writeColor(b.targetColor)` AND
   * `writeDepth(b.targetDepth)`: a colour-only declaration resolves to a different (colour-only)
   * target, falling out of the screen binding / keep-open weave and, inside a 2D filter, losing
   * the inset frame.
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
   * Declare that this pass produces `handle` *without* a render-pass attachment write
   *
   * E.g. a `copyToTexture` blit, an internal multi-target loop (Shadow), or a future compute
   * dispatch. Same dependency / lifetime / anchoring as {@link PassBuilder#writeColor}, but the
   * executor doesn't push a target — the pass owns the GPU mechanism.
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
   * The executor's auto-bind loop sets the resolved texture on the global bind group at `slot`
   * before the pass renders.
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
   * Declare a read dependency without a shader binding
   *
   * For transfer-style work (`copyToTexture` blits, manual `TextureView` construction) — same
   * write-before-read edge as {@link PassBuilder#sample}, but the executor's auto-bind
   * loop skips it.
   * @param handle - The resource this pass reads.
   * @returns The same handle, for inline capture.
   */
  public read<H extends ResourceHandle>(handle: H): H {
    const record = this._mustBeInSetup('read');
    record.accesses.push({ handle, mode: 'read' });
    return handle;
  }

  /**
   * Register a graph-allocated colour texture
   *
   * The descriptor runs each frame; the graph reallocates only when a field changes. Delegates
   * to {@link RenderGraph#createColor}.
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

  // --- Internal API (called by RenderGraph.addPass around each setup call) ---

  /**
   * Starts collecting declared accesses into `record` until `_endPass`
   *
   * Seeds {@link PassBuilder#targetColor} / {@link PassBuilder#targetDepth} from `camera`:
   * that camera's render texture, or the scene pair when it has none.
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
