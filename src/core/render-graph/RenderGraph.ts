import { CLEAR, Rectangle, RendererType, Texture, TexturePool, TextureView } from 'pixi.js';
import type {
  BindableTexture,
  BindOptions,
  BindResource,
  PointData,
  RenderTarget,
  WebGLRenderer,
  WebGPURenderer,
  TextureSource,
} from 'pixi.js';

import type { Camera3D } from '../../scene/cameras/Camera3D';
import { getCameraData } from '../CameraData';
import { prepareCamera, uploadCamera } from '../prepareCamera';
import type { RenderSession } from '../render-passes/RenderSession';
import { DEPTH_VIEW_PLACEHOLDER } from '../textures/DefaultTextures';
import { cameraFrameToPhysicalViewport } from './frameToPhysicalViewport';
import type { GraphRenderPass } from './GraphRenderPass';
import { PassBuilder } from './PassBuilder';
import type { PassRecord, ResourceAccess } from './PassBuilder';
import { RenderTargetCache } from './RenderTargetCache';
import type { PassAttachments } from './RenderTargetCache';
import type {
  ColorHandle,
  DepthHandle,
  ResourceDescriptor,
  ResourceHandle,
  ResourceKind,
  TransientTextureOptions,
} from './ResourceHandle';

/** Format of every depth buffer the graph allocates */
const DEPTH_FORMAT = 'depth24plus-stencil8';

/** Reused destination for {@link transientContentSize} on the descriptor path */
const _contentSize = { width: 0, height: 0 };

/**
 * The content size transient options ask for this frame, in texels
 *
 * Pixi's rule: texels = logical size × resolution. The logical size defaults to the view's
 * viewport (physical viewport over the target's resolution) and the resolution to the target's
 * own, so `{}` is the physical viewport and `resolution: 1` is one texel per logical pixel. The
 * pool decides the texture this content sits in, and consumers map through the resulting `frame`.
 * The descriptor a transient is acquired with and {@link RenderGraph#sceneViewport} both come
 * through here, so they can't disagree.
 * @param options - The caller's transient texture options
 * @param s - The frame's render session
 * @param out - Receives the size; nothing else on it is touched
 * @returns `out`, for inline use
 */
function transientContentSize<T extends { width: number; height: number }>(
  options: TransientTextureOptions,
  s: RenderSession,
  out: T,
): T {
  const targetResolution = s.defaultTarget.colorTexture.source.resolution;
  const resolution =
    options.resolution === undefined || options.resolution === 'inherit' ? targetResolution : options.resolution;
  const width = options.width ?? s.viewport.width / targetResolution;
  const height = options.height ?? s.viewport.height / targetResolution;
  out.width = Math.max(1, Math.round(width * resolution));
  out.height = Math.max(1, Math.round(height * resolution));
  return out;
}

/**
 * Expand transient options into the per-frame descriptor the pool consumes
 *
 * Size comes from {@link transientContentSize}. An unset format falls back to the view target's,
 * or `depth24plus-stencil8` for depth, and depth samples `'nearest'`.
 * @param type - Colour or depth; picks the default format, label and sampling
 * @param options - The caller's transient texture options
 */
function toDescribe(type: ResourceKind, options: TransientTextureOptions): (s: RenderSession) => ResourceDescriptor {
  const depth = type === 'depth';
  const scaleMode = options.scaleMode ?? (depth ? 'nearest' : undefined);
  return (s: RenderSession) => {
    const source = s.defaultTarget.colorTexture.source;
    const size = transientContentSize(options, s, _contentSize);
    const descriptor: ResourceDescriptor = {
      width: size.width,
      height: size.height,
      format: options.format ?? (depth ? DEPTH_FORMAT : (source.format ?? 'bgra8unorm')),
      autoGenerateMipmaps: options.autoGenerateMipmaps ?? false,
      label: options.label ?? (depth ? 'depthTransient' : 'colorTransient'),
    };
    if (scaleMode) descriptor.scaleMode = scaleMode;
    return descriptor;
  };
}

interface ResolvedTarget {
  /** Framebuffer to bind, or `null` when the pass has no attachments */
  target: RenderTarget | null;
  /** `flipY` to pass to `bind` with this target */
  flipY: boolean;
  /**
   * Logical rect to bind at, or `null` for the whole target
   *
   * Offscreen: the content frame of the first colour (else first transient depth).
   * The screen bind ignores this and uses the view camera's frame — that target's colour
   * is still a texture, but the view is an inset of it.
   */
  frame: Rectangle | null;
}

/**
 * The render target a camera's passes draw into, and that target's content rect in physical
 * pixels: what a copy of that camera's picture reads
 *
 * The graph keeps one per camera target and one for the scene pair, and reuses them across
 * frames. `colorSource` and `depthSource` are the sources `target` was looked up under. A later
 * call reuses `target` while both are unchanged.
 * @internal
 */
export interface DrawTarget {
  /** The render target the camera's passes draw into */
  target: RenderTarget;
  /** The target's content rect in physical pixels: a transient's content frame, or the view's rect on the screen */
  readonly viewport: Rectangle;
  /** Colour source `target` was looked up under, or `null` when the colour was released */
  colorSource: TextureSource | null;
  /** Depth source `target` was looked up under, or `null` when the depth was released */
  depthSource: TextureSource | null;
}

/** Offscreen bind, in texels — `session.activeViewport` points here */
const _activeViewport = new Rectangle();
const _resolvedTarget: ResolvedTarget = { target: null, flipY: false, frame: null };
/**
 * Scratch key for a draw target's cache lookup, patched per lookup
 *
 * Its attachments go back to `Texture.EMPTY` after each lookup, so this module-level key never
 * keeps a source alive.
 */
const _drawTargetKey: PassAttachments = {};
const _drawTargetColors = [{ texture: Texture.EMPTY.source }];
const _drawTargetDepth = { texture: Texture.EMPTY.source };

/**
 * Scale a logical frame to physical pixels, at least one pixel each way
 * @param frame - The frame, in the texture's logical units.
 * @param resolution - The texture's resolution.
 * @param out - Where the physical rect is written.
 * @returns `out`
 */
function toPhysicalRect(frame: Rectangle, resolution: number, out: Rectangle): Rectangle {
  out.x = Math.round(frame.x * resolution);
  out.y = Math.round(frame.y * resolution);
  out.width = Math.max(1, Math.round(frame.width * resolution));
  out.height = Math.max(1, Math.round(frame.height * resolution));
  return out;
}

/**
 * What a camera with a render texture draws into, and where the picture ends up
 *
 * The passes write the target — a colour and depth transient pair sized from the texture —
 * and the graph copies it into the texture after the last pass that writes its colour. The
 * texture is never an attachment, so a mesh in the same view can sample it while the camera
 * draws: it reads last frame's picture. Passes reach the target through the builder's
 * `targetColor` / `targetDepth`, and copies reach it through `RenderGraph._drawTarget`.
 * @internal
 */
interface CameraTarget {
  /** Colour the camera's passes write, pooled, the size of the texture's frame */
  color: ColorHandle;
  /** Depth paired with `color` */
  depth: DepthHandle;
  /** The camera's {@link Camera3D#renderTexture}, imported so the graph can generate its mipmaps after the copy */
  texture: ColorHandle;
  /** `color` and `depth` as a render target, once a copy has looked it up */
  draw: DrawTarget | null;
}

/**
 * A resource in the graph's resource table — either externally owned
 * (`imported`, resolved each frame via `getter`) or graph-allocated
 * (`transient`, acquired/released around its first and last use)
 *
 * `cachedTexture` wraps an imported bare source, and `cachedDepthView` is the depth-only view a
 * depth handle binds through, since WebGPU's `texture_depth_2d` binding takes only the depth
 * aspect of a depth-stencil texture. Each is rebuilt when its source changes, and the old one is
 * destroyed rather than dropped: it listens on its source, and pooled sources outlive it, so a
 * dropped wrapper would stay pinned to the pool. A transient's depth view survives the per-frame
 * release on purpose: the steady state gets the same pooled source back and reuses the view
 * without allocating.
 */
type ResourceEntry =
  | {
      kind: 'imported';
      type: ResourceKind;
      getter: (session: RenderSession) => BindableTexture;
      cachedTexture: Texture | null;
      cachedDepthView: TextureView | null;
      cachedDepthViewSource: TextureSource | null;
    }
  | {
      kind: 'transient';
      type: ResourceKind;
      describe: (session: RenderSession) => ResourceDescriptor;
      /**
       * Set between firstUse acquire and lastUse release; null otherwise
       *
       * A `Texture` rather than a raw source, because its `frame` is where the content sits
       * inside the pooled texture, the one fact every consumer needs.
       */
      texture: Texture | null;
      cachedTexture: Texture | null;
      cachedDepthView: TextureView | null;
      cachedDepthViewSource: TextureSource | null;
    };

interface AddedPass {
  pass: GraphRenderPass;
  record: PassRecord;
  /** Passes this one reads after or writes after, set by `compile()` */
  dependsOn: AddedPass[];
  /** Writes or produces an imported texture or a camera target, so `resolve()` keeps it and works back from it */
  isAnchored: boolean;
  /**
   * Cameras whose target is copied into their render texture after this pass renders — the
   * ones this pass is the last active writer for this frame
   *
   * Rebuilt by `resolve()`. The copy runs before `AddedPass.mipmapHandles`, which holds
   * the texture's handle for the same pass, so mipmaps are generated from the copied picture.
   */
  copyCameras: Camera3D[];
  /**
   * Colour handles whose mipmaps are generated after this pass renders — the ones it is the
   * last writer of this frame
   *
   * Rebuilt by `resolve()`. `execute()` generates for any of them whose source is flagged
   * `autoGenerateMipmaps`: the picture is complete, and nothing later in the frame has sampled
   * it yet. Generating in the frame's own order puts it, on WebGPU, on the frame encoder between
   * this write and the next read. That is the whole of mipmap generation in the graph — the flag
   * on the texture is the declaration, and no pass says "mipmaps".
   */
  mipmapHandles: ColorHandle[];
  /**
   * Pre-built attachment shape for `_renderTargetCache.get`
   *
   * Shape is fixed at compile time; `texture` fields are patched each frame in
   * `_resolveTarget`. `null` for a pass with no attachments, which binds its own targets.
   */
  attachments: PassAttachments | null;
  /** Color handles parallel to `attachments.colors`, resolved per frame */
  colorHandles: ColorHandle[];
  /** Depth handle backing `attachments.depth`, resolved per frame, or `null` */
  depthHandle: DepthHandle | null;
  /**
   * Handles to bind as `sample` accesses before `pass.render()` runs
   *
   * Built once in `compile()` so `execute()` walks only sample accesses instead
   * of filtering the full record each frame; parallel to `sampleSlots`.
   */
  sampleHandles: ResourceHandle[];
  /** Bind-group slots for `sampleHandles`, same length, same order */
  sampleSlots: number[];
  /**
   * Underlying source uid last bound to each `sampleHandles[j]`
   *
   * When it changes, `execute()` makes the pass re-record its WebGPU render bundles, which baked
   * the old texture. A pooled transient changes texture when a resize moves its request to a
   * different pool size: the next power of two, or the canvas size when that fits and is smaller.
   * Parallel to `sampleHandles`; `-1` = not yet bound.
   */
  lastSampleSourceUids: number[];
  /**
   * Cached `RenderTarget` from the last `_resolveTarget` call, which says when it is reused
   *
   * `compile()` clears it along with the attachment shape it was looked up by, and
   * `_invalidatePerPassTargets` clears it when the render-target cache is reset.
   */
  cachedTarget: RenderTarget | null;
  /**
   * Allocation-free membership marks for the `resolve()` cull
   *
   * Compared against the graph-level `_resolveTick` that bumps each frame:
   * `candidateTick === tick` ⇔ pass survived this frame's `condition()`;
   * `neededTick === tick` ⇔ pass survived the cull. Stale marks
   * from prior frames are naturally invalid against the new tick.
   */
  candidateTick: number;
  neededTick: number;
}

/**
 * Construction options for {@link RenderGraph}
 *
 * The default-attachment getters run each frame, so the graph follows a resize or a new
 * swap-chain texture by itself.
 * @category rendering
 * @advanced
 */
export interface RenderGraphOptions {
  /** Resolves the View's default (screen) colour attachment for the frame */
  defaultColor: (session: RenderSession) => BindableTexture;
  /** Resolves the View's default (screen) depth attachment for the frame */
  defaultDepth: (session: RenderSession) => BindableTexture;
  /**
   * Composite mode: the colour transient the scene draws into, which an output pass then draws
   * onto the default target
   *
   * Omit it and {@link RenderGraphOptions#sceneDepth} for direct mode, where the scene draws
   * straight into the default (screen) targets. Fixed for the graph's lifetime.
   */
  sceneColor?: TransientTextureOptions;
  /** Depth counterpart of {@link RenderGraphOptions#sceneColor} — provide both or neither */
  sceneDepth?: TransientTextureOptions;
}

/**
 * The ordered list of passes a {@link View3D} renders, with the textures they read and write
 *
 * Each pass declares what it writes, reads and samples in `setup(builder)`. From that the graph
 * orders passes, rejects a pass that reads what it writes, and each frame skips passes whose
 * output nothing uses. It also hands out pooled textures for the length of their use and binds
 * each pass's render target.
 *
 * Lifecycle: `addPass` each pass, `compile()` once, then `run(session)` every frame.
 * @category rendering
 * @advanced
 */
export class RenderGraph {
  private readonly _resources: ResourceEntry[] = [];
  private readonly _passes: AddedPass[] = [];

  private readonly _builder: PassBuilder;

  /** Render targets keyed by attachment uids, reset when the default target's textures change */
  private readonly _renderTargetCache: RenderTargetCache = new RenderTargetCache();

  /**
   * Key `_prepareDefaultTarget` seeds `session.defaultTarget` under, patched in place with the
   * default target's live sources; the `Texture.EMPTY` placeholders never match a real source
   */
  private readonly _defaultCacheKey: PassAttachments = {
    colors: [{ texture: Texture.EMPTY.source }],
    depth: { texture: Texture.EMPTY.source },
  };

  /**
   * `_defaultCacheKey` for a pass that only depth-tests against the default target; shares its
   * attachment objects, so the per-frame source swap reaches both keys
   */
  private readonly _defaultCacheKeyReadOnlyDepth: PassAttachments = {
    colors: this._defaultCacheKey.colors,
    depth: this._defaultCacheKey.depth,
    depthReadOnly: true,
  };

  /**
   * Target and texture per camera with a render texture
   *
   * Minted by `RenderGraph._cameraTarget` on the first pass that names the camera.
   */
  private readonly _cameraTargets = new Map<Camera3D, CameraTarget>();

  /** The scene pair as a render target, once a copy has looked it up: see `RenderGraph._drawTarget` */
  private _sceneDrawTarget: DrawTarget | null = null;

  private readonly _camerasSeen = new Set<Camera3D>();

  /**
   * Ids of every camera target's colour transient
   *
   * Two things set a camera target apart from other transients. Its writers are anchored like
   * writers of an imported texture: the graph copies it into the camera's texture, so its output
   * is used, just not through a pass access the cull could see. And it binds with the outer
   * binding's `flipY` rather than the transient flip `execute` describes, so it is stored the way a
   * render texture is and the copy lands the right way up.
   */
  private readonly _cameraTargetColors = new Set<number>();

  /**
   * The colour scene passes draw into, and what {@link PassBuilder#targetColor} is for a pass
   * drawing the view
   *
   * The default (screen) colour in direct mode, or a transient in composite mode
   * ({@link RenderGraphOptions#sceneColor}). Fixed at construction.
   */
  public readonly sceneColor: ColorHandle;
  /** Depth target paired with {@link RenderGraph#sceneColor} */
  public readonly sceneDepth: DepthHandle;
  /**
   * Options {@link RenderGraph#sceneColor} was created from, or `null` in direct mode
   *
   * Kept so {@link RenderGraph#sceneViewport} can size the scene target without running the
   * entry's `describe`, which allocates a descriptor per call.
   */
  private readonly _sceneColorOptions: TransientTextureOptions | null;
  /** The View's default (screen) colour attachment — its final output */
  public readonly defaultColor: ColorHandle;
  /** Depth attachment paired with {@link RenderGraph#defaultColor} */
  public readonly defaultDepth: DepthHandle;

  /** Last frame's default-attachment uids, or `-1` before the first; `_maybeResetRenderTargetCache` compares them */
  private _lastColorUid = -1;
  private _lastDepthUid = -1;

  /** Passes that survived this frame's `condition` and cull, in declaration order */
  private readonly _activePasses: AddedPass[] = [];

  /** Transient ids to acquire before pass `i` binds its target, rebuilt each `resolve()` */
  private readonly _acquireAt: number[][] = [];

  /** Transient ids to release after pass `i`'s `render()` returns — rebuilt each `resolve()` */
  private readonly _releaseAt: number[][] = [];

  /**
   * Active-pass indices of each resource's first and last use, and first and last writer, this
   * frame, indexed by `handle._id`
   *
   * `-1` means untouched this frame. Grown on demand to `_resources.length` and refilled with `-1`
   * each `resolve()`, so nothing is allocated per frame. Use drives transient acquire and release,
   * the first writer drives `_effectiveLoadOp`, and the last writer places mipmap generation.
   */
  private _firstUseByResId: Int32Array = new Int32Array(0);
  private _lastUseByResId: Int32Array = new Int32Array(0);
  private _firstWriterByResId: Int32Array = new Int32Array(0);
  private _lastWriterByResId: Int32Array = new Int32Array(0);
  /** The colour handle behind `_lastWriterByResId[id]`, so the walk has a handle to resolve */
  private readonly _lastWrittenHandleByResId: (ColorHandle | undefined)[] = [];

  /**
   * Bumped at the top of each `resolve()`
   *
   * Compared against per-pass `candidateTick` / `neededTick` for allocation-free membership
   * checks during the cull. At 60 fps it stays a safe integer for millions of years.
   */
  private _resolveTick = 0;

  /** Reused scratch: survivors of `condition()` and the DFS stack for the cull */
  private readonly _resolveCandidates: AddedPass[] = [];
  private readonly _resolveStack: AddedPass[] = [];

  /**
   * Reused capture of the binding live when `execute` starts: the canvas or a filter's texture, its
   * frame, orientation and subresource
   *
   * Replayed when `execute` ends, so 2D content and other views drawn after this one land where
   * they would have. `getBindState` captures it with no clear, so the replay never wipes the target.
   */
  private _savedBind?: BindOptions;

  private _destroyed = false;

  constructor(opts: RenderGraphOptions) {
    this.defaultColor = this.importColor(opts.defaultColor);
    this.defaultDepth = this.importDepth(opts.defaultDepth);
    this.sceneColor = opts.sceneColor ? this.createColor(opts.sceneColor) : this.defaultColor;
    this.sceneDepth = opts.sceneDepth ? this.createDepth(opts.sceneDepth) : this.defaultDepth;
    this._sceneColorOptions = opts.sceneColor ?? null;
    this._builder = new PassBuilder(this);
  }

  /**
   * Register an externally owned colour texture
   *
   * The getter runs each frame, so the graph follows a resized or swapped texture without
   * registering it again. A pass that writes an imported texture always survives the cull.
   * @param getter - Resolves the live texture for the frame.
   * @returns The handle for the imported colour resource.
   */
  public importColor(getter: (s: RenderSession) => BindableTexture): ColorHandle {
    return this._importResource('color', getter) as ColorHandle;
  }

  /**
   * Register an externally owned depth texture — see {@link RenderGraph#importColor}
   * @param getter - Resolves the live texture for the frame.
   * @returns The handle for the imported depth resource.
   */
  public importDepth(getter: (s: RenderSession) => BindableTexture): DepthHandle {
    return this._importResource('depth', getter) as DepthHandle;
  }

  /**
   * Register a graph-allocated colour texture
   *
   * Its size is worked out each frame, so it follows the viewport. The texture comes from pixi's
   * `TexturePool` before the first pass that uses it and goes back after the last, so transients
   * whose uses don't overlap can share one texture.
   * @param options - Size, resolution, format and label — see {@link TransientTextureOptions}.
   * @returns The handle for the transient colour resource.
   */
  public createColor(options: TransientTextureOptions = {}): ColorHandle {
    return this._createTransient('color', toDescribe('color', options)) as ColorHandle;
  }

  /**
   * Register a graph-allocated depth texture — see {@link RenderGraph#createColor}
   * @param options - Size, resolution, format and label — see {@link TransientTextureOptions}.
   * @returns The handle for the transient depth resource.
   */
  public createDepth(options: TransientTextureOptions = {}): DepthHandle {
    return this._createTransient('depth', toDescribe('depth', options)) as DepthHandle;
  }

  /**
   * The target a pass drawing from `camera` writes — what the builder seeds `targetColor` /
   * `targetDepth` with for a pass on a camera with a render texture — and the texture it is
   * copied into
   *
   * The target is a pooled colour + depth pair described from the texture each frame, so a
   * resized or swapped texture is followed without a rebuild, in the texture's own format so
   * the copy is texel for texel. As a transient, its first writer clears it. The copy runs
   * after the camera's last active pass that writes the colour (`resolve` finds it, `execute` does it).
   * @param camera - A camera with a render texture.
   * @returns The camera's target and texture handles.
   * @internal
   */
  public _cameraTarget(camera: Camera3D): CameraTarget {
    if (!camera.renderTexture) {
      throw new Error('RenderGraph._cameraTarget: this camera has no renderTexture.');
    }

    let target = this._cameraTargets.get(camera);

    if (target) return target;

    const textureSize = (): { width: number; height: number } => {
      const { frame, source } = camera.renderTexture!;
      return {
        width: Math.max(1, Math.round(frame.width * source.resolution)),
        height: Math.max(1, Math.round(frame.height * source.resolution)),
      };
    };

    target = {
      color: this._createTransient('color', () => ({
        ...textureSize(),
        format: camera.renderTexture!.source.format,
        label: 'cameraTarget',
      })) as ColorHandle,
      depth: this._createTransient('depth', () => ({
        ...textureSize(),
        format: DEPTH_FORMAT,
        label: 'cameraTargetDepth',
      })) as DepthHandle,
      texture: this._importResource('color', () => camera.renderTexture!) as ColorHandle,
      draw: null,
    };
    this._cameraTargetColors.add(target.color._id);

    this._cameraTargets.set(camera, target);

    return target;
  }

  /**
   * The render target `camera`'s passes draw into, and that target's content rect: what a copy of
   * that camera's picture reads
   *
   * A camera with a render texture draws into its camera target, and any other camera draws into
   * the scene pair. The rect is the target's content frame in physical pixels, or the view's rect
   * on the screen when the scene pair is the screen. It is the whole of that rect: a camera's own
   * `viewport` doesn't narrow it. A copy reads from here, whatever is bound, so a pass on another
   * target running in between can't redirect it.
   *
   * The graph looks the target up in the render-target cache under the pair's colour and depth,
   * so it is the `RenderTarget` that a pass writing both of them binds. For the screen it is
   * pixi's own target, not a second one around the same textures. That matters on WebGL, where a
   * copy first resolves a multisampled source from that source's own buffers. Only the screen
   * can be multisampled, and its buffers are the ones the draws filled. When the colour or the
   * depth was already released this frame, the target leaves it out. That happens to the depth
   * when the last pass that writes a camera's colour runs after the depth's last use. The graph
   * repeats the lookup only when a source changes. It refreshes the rect on every call, because
   * a pooled source can come back with a different content size.
   * @param camera - The camera whose picture is copied, or `null` for the view's camera.
   * @param session - The frame's render session.
   * @returns The camera's draw target, reused across calls.
   * @internal
   */
  public _drawTarget(camera: Camera3D | null, session: RenderSession): DrawTarget {
    const cameraTarget = camera?.renderTexture ? this._cameraTarget(camera) : null;
    const colorEntry = this._resources[(cameraTarget?.color ?? this.sceneColor)._id];
    const depthEntry = this._resources[(cameraTarget?.depth ?? this.sceneDepth)._id];
    const colorSource = this._liveSource(colorEntry, session);
    const depthSource = this._liveSource(depthEntry, session);

    let draw = cameraTarget ? cameraTarget.draw : this._sceneDrawTarget;

    if (draw === null || draw.colorSource !== colorSource || draw.depthSource !== depthSource) {
      if (colorSource) _drawTargetColors[0].texture = colorSource;
      if (depthSource) _drawTargetDepth.texture = depthSource;
      _drawTargetKey.colors = colorSource ? _drawTargetColors : undefined;
      _drawTargetKey.depth = depthSource ? _drawTargetDepth : undefined;
      const target = this._renderTargetCache.get(_drawTargetKey);
      _drawTargetColors[0].texture = Texture.EMPTY.source;
      _drawTargetDepth.texture = Texture.EMPTY.source;

      if (draw === null) {
        draw = { target, viewport: new Rectangle(), colorSource, depthSource };
        if (cameraTarget) cameraTarget.draw = draw;
        else this._sceneDrawTarget = draw;
      } else {
        draw.target = target;
        draw.colorSource = colorSource;
        draw.depthSource = depthSource;
      }
    }

    const colorTexture = colorEntry.kind === 'transient' ? colorEntry.texture : null;
    const content = colorTexture ?? (depthEntry.kind === 'transient' ? depthEntry.texture : null);

    if (content) toPhysicalRect(content.frame, content.source.resolution, draw.viewport);
    else draw.viewport.copyFrom(session.viewport);

    return draw;
  }

  /** Passes in declaration order, in a new array the caller can keep */
  public get passes(): GraphRenderPass[] {
    const out: GraphRenderPass[] = [];
    for (let i = 0; i < this._passes.length; i++) out.push(this._passes[i].pass);
    return out;
  }

  /**
   * The UV scale mapping `[0,1]` viewport space onto a viewport-sized transient's sub-rect
   *
   * The pool decides what texture a viewport-sized request lands in, so the scale comes from
   * `TexturePool.getOptimalSize`.
   * @param pixelWidth - Viewport width in physical pixels.
   * @param pixelHeight - Viewport height in physical pixels.
   * @param out - Destination for the scale.
   */
  public setViewportUvScale(pixelWidth: number, pixelHeight: number, out: PointData): void {
    const size = TexturePool.getOptimalSize(pixelWidth, pixelHeight);
    out.x = pixelWidth / size.width;
    out.y = pixelHeight / size.height;
  }

  /**
   * The scene target's content rect, in physical pixels, available before any target is bound
   *
   * Direct rendering uses the view's place on the target. Composite rendering uses a transient
   * whose content starts at the origin.
   * @param session - The frame's render session, with `viewport` filled.
   * @param out - Receives the rect.
   * @returns `out`, for inline use.
   */
  public sceneViewport(session: RenderSession, out: Rectangle): Rectangle {
    const options = this._sceneColorOptions;

    if (!options) return out.copyFrom(session.viewport);

    out.x = 0;
    out.y = 0;
    transientContentSize(options, session, out);
    return out;
  }

  /**
   * Register a pass
   *
   * Runs `pass.setup(builder)` immediately so its accesses are recorded; the pass should stash
   * any returned handles for use in `render()`.
   * @param pass - The pass to register.
   * @returns The same pass, for inline capture.
   */
  public addPass<T extends GraphRenderPass>(pass: T): T {
    const record: PassRecord = { accesses: [] };
    this._passes.push({
      pass,
      record,
      dependsOn: [],
      isAnchored: false,
      attachments: null,
      colorHandles: [],
      depthHandle: null,
      sampleHandles: [],
      sampleSlots: [],
      lastSampleSourceUids: [],
      cachedTarget: null,
      candidateTick: 0,
      neededTick: 0,
      copyCameras: [],
      mipmapHandles: [],
    });

    this._builder._beginPass(record, pass.camera);
    try {
      pass.setup(this._builder);
    } finally {
      this._builder._endPass();
    }

    return pass;
  }

  /**
   * Works out, once, what each pass depends on and which render target it binds
   *
   * Idempotent: it starts every pass afresh. A pass that writes a texture depends on the texture's
   * previous writer. A pass that reads or samples one depends on every earlier writer, not just
   * the last, because the last can drop out through its `condition`. The composite scene colour
   * shows why: the depth clear, background, opaque and transparent passes all write it, and when a
   * transmission pass with no glass drops out, a chain of writers would lose every writer before
   * it. A pass that writes an imported texture or a camera target is one the cull keeps and works
   * back from.
   *
   * A pass's render target comes from its `writeColor`, `writeDepth` and `readDepthAttachment`
   * declarations only, so a read-only attachment is always a depth.
   *
   * Throws if a pass both writes and reads or samples the same texture. A pass declares a handful
   * of accesses, so that check scans them directly instead of building a Set.
   */
  public compile(): void {
    for (let i = 0; i < this._passes.length; i++) {
      const ap = this._passes[i];
      ap.dependsOn.length = 0;
      ap.isAnchored = false;
      ap.attachments = null;
      ap.colorHandles.length = 0;
      ap.depthHandle = null;
      ap.sampleHandles.length = 0;
      ap.sampleSlots.length = 0;
      ap.lastSampleSourceUids.length = 0;
      ap.cachedTarget = null;
    }

    const writersById: Record<number, AddedPass[]> = Object.create(null);

    for (let i = 0; i < this._passes.length; i++) {
      const ap = this._passes[i];
      const accesses = ap.record.accesses;

      let hasAttachment = false;
      let depthReadOnly = false;

      for (let j = 0; j < accesses.length; j++) {
        const a = accesses[j];
        const id = a.handle._id;

        if (a.mode === 'write_attachment' || a.mode === 'produce') {
          const writers = writersById[id] ?? (writersById[id] = []);
          const prev = writers[writers.length - 1];
          if (prev && prev !== ap && !ap.dependsOn.includes(prev)) {
            ap.dependsOn.push(prev);
          }
          writers.push(ap);

          if (this._resources[id].kind === 'imported' || this._cameraTargetColors.has(id)) ap.isAnchored = true;
        } else {
          for (let k = 0; k < accesses.length; k++) {
            const b = accesses[k];
            if (k === j) continue;
            if ((b.mode === 'write_attachment' || b.mode === 'produce') && b.handle._id === id) {
              throw new Error(
                `RenderGraph.compile: pass "${ap.pass.name}" both writes and reads (mode=${a.mode}) the same resource (id ${id}). ` +
                  'A texture can only be one of (writable attachment) or (sampled / read-only) within a single pass.',
              );
            }
          }

          const writers = writersById[id];
          if (writers) {
            for (let w = 0; w < writers.length; w++) {
              const writer = writers[w];
              if (writer !== ap && !ap.dependsOn.includes(writer)) ap.dependsOn.push(writer);
            }
          }

          if (a.mode === 'sample') {
            ap.sampleHandles.push(a.handle);
            ap.sampleSlots.push(a.slot!);
            ap.lastSampleSourceUids.push(-1);
          }
        }

        if (a.mode === 'write_attachment') {
          hasAttachment = true;
          if (a.handle._kind === 'color') {
            ap.colorHandles.push(a.handle as ColorHandle);
          } else {
            ap.depthHandle = a.handle as DepthHandle;
          }
        } else if (a.mode === 'read_attachment') {
          hasAttachment = true;
          ap.depthHandle = a.handle as DepthHandle;
          depthReadOnly = true;
        }
      }

      if (!hasAttachment) continue;

      const attachments: PassAttachments = {};
      if (ap.colorHandles.length > 0) {
        const colors: {
          /** Placeholder attachment texture, patched to the resolved source each frame */
          texture: TextureSource;
        }[] = [];
        for (let k = 0; k < ap.colorHandles.length; k++) {
          colors.push({ texture: Texture.EMPTY.source });
        }
        attachments.colors = colors;
      }
      if (ap.depthHandle !== null) {
        attachments.depth = { texture: Texture.EMPTY.source };
        if (depthReadOnly) attachments.depthReadOnly = true;
      }
      ap.attachments = attachments;
    }
  }

  /**
   * Renders one frame: picks this frame's passes, builds the cameras they draw from, then draws them
   *
   * Everything that is true of the view whatever passes run is settled before this is called: its
   * own camera by the scene update, its lights and globals by the pipe's `prepareView`.
   * @param session - The frame's render session.
   */
  public run(session: RenderSession): void {
    this.resolve(session);
    this.prepareCameras(session);
    this.execute(session);
  }

  /**
   * Picks this frame's passes and plans their textures
   *
   *  1. Drops passes whose optional `condition(session)` returns false.
   *  2. Keeps only the passes reachable backward through their dependencies from a pass that
   *     writes an imported texture or a camera target, in declaration order. A dependency its
   *     own `condition` dropped doesn't keep anything: its output isn't drawn this frame, and a
   *     pass reading it sees whatever the texture last held.
   *
   * It then plans the frame: where each transient is acquired and released, each texture's first
   * writer, which decides between clearing and loading, and each colour's last writer, after which
   * its mipmaps are generated.
   *
   * A camera's target is copied into its render texture after the last active pass that writes
   * the camera's colour, and the texture's mipmaps are generated after that copy. That pass is the
   * last point the colour is still allocated: a later pass of the camera that only reads its depth
   * runs after the colour is released. A camera whose colour nothing writes this frame keeps its
   * last picture.
   * @param session - The frame's render session.
   * @internal
   */
  public resolve(session: RenderSession): void {
    this._activePasses.length = 0;

    const tick = ++this._resolveTick;

    const candidates = this._resolveCandidates;
    candidates.length = 0;
    for (let i = 0; i < this._passes.length; i++) {
      const ap = this._passes[i];
      if (ap.pass.condition?.(session) ?? true) {
        ap.candidateTick = tick;
        candidates.push(ap);
      }
    }
    if (candidates.length === 0) return;

    const stack = this._resolveStack;
    stack.length = 0;
    for (let i = 0; i < candidates.length; i++) {
      const ap = candidates[i];
      if (ap.isAnchored) {
        ap.neededTick = tick;
        stack.push(ap);
      }
    }
    while (stack.length > 0) {
      const ap = stack.pop()!;
      const deps = ap.dependsOn;
      for (let i = 0; i < deps.length; i++) {
        const dep = deps[i];
        if (dep.candidateTick !== tick || dep.neededTick === tick) continue;
        dep.neededTick = tick;
        stack.push(dep);
      }
    }

    for (let i = 0; i < this._passes.length; i++) {
      const ap = this._passes[i];
      if (ap.neededTick === tick) this._activePasses.push(ap);
    }

    const n = this._activePasses.length;
    while (this._acquireAt.length < n) {
      this._acquireAt.push([]);
      this._releaseAt.push([]);
    }
    for (let i = 0; i < n; i++) {
      this._acquireAt[i].length = 0;
      this._releaseAt[i].length = 0;
      this._activePasses[i].copyCameras.length = 0;
      this._activePasses[i].mipmapHandles.length = 0;
    }

    const resCount = this._resources.length;
    if (this._firstUseByResId.length < resCount) {
      this._firstUseByResId = new Int32Array(resCount);
      this._lastUseByResId = new Int32Array(resCount);
      this._firstWriterByResId = new Int32Array(resCount);
      this._lastWriterByResId = new Int32Array(resCount);
      this._lastWrittenHandleByResId.length = resCount;
    }
    const firstUse = this._firstUseByResId;
    const lastUse = this._lastUseByResId;
    const firstWriter = this._firstWriterByResId;
    const lastWriter = this._lastWriterByResId;
    const lastWrittenHandle = this._lastWrittenHandleByResId;
    firstUse.fill(-1, 0, resCount);
    lastUse.fill(-1, 0, resCount);
    firstWriter.fill(-1, 0, resCount);
    lastWriter.fill(-1, 0, resCount);

    for (let i = 0; i < n; i++) {
      const accesses = this._activePasses[i].record.accesses;
      for (let j = 0; j < accesses.length; j++) {
        const a = accesses[j];
        const id = a.handle._id;
        const entry = this._resources[id];
        if (entry.kind === 'transient') {
          if (firstUse[id] === -1) firstUse[id] = i;
          lastUse[id] = i;
        }
        if (a.mode === 'write_attachment' || a.mode === 'produce') {
          if (firstWriter[id] === -1) firstWriter[id] = i;
          if (entry.type === 'color') {
            lastWriter[id] = i;
            lastWrittenHandle[id] = a.handle as ColorHandle;
          }
        }
      }
    }

    for (let id = 0; id < resCount; id++) {
      const first = firstUse[id];
      if (first !== -1) {
        this._acquireAt[first].push(id);
        this._releaseAt[lastUse[id]].push(id);
      }
      const last = lastWriter[id];
      if (last !== -1) this._activePasses[last].mipmapHandles.push(lastWrittenHandle[id]!);
    }

    const seen = this._camerasSeen;
    seen.clear();
    for (let i = n - 1; i >= 0; i--) {
      const ap = this._activePasses[i];
      const camera = ap.pass.camera;
      if (!camera?.renderTexture || seen.has(camera)) continue;
      const cameraTarget = this._cameraTarget(camera);
      if (lastWriter[cameraTarget.color._id] !== i) continue;
      seen.add(camera);
      ap.copyCameras.push(camera);
      ap.mipmapHandles.push(cameraTarget.texture);
    }
  }

  /**
   * Build the camera of every pass that survived {@link RenderGraph#resolve}
   *
   * Only pass cameras are built here: the view's own is the pipe's, built before `resolve` so a
   * pass's `condition` can ask about this frame. `prepareCamera` stamps the session, so a camera
   * two passes name is built once. `uploadCamera` then finishes and uploads every camera, the
   * view's included: by now the view has packed its lights, which the light tiles need.
   *
   * Runs before any render target is bound, so every camera reads the same winding off the same
   * binding. Call after {@link RenderGraph#resolve}, before {@link RenderGraph#execute}.
   * @param session - The frame's render session.
   * @internal
   */
  public prepareCameras(session: RenderSession): void {
    uploadCamera(session.view3d.camera, session);

    for (let i = 0; i < this._activePasses.length; i++) {
      const camera = this._activePasses[i].pass.camera;
      if (!camera) continue;

      prepareCamera(camera, session);
      uploadCamera(camera, session);
    }
  }

  /**
   * Draws this frame's active passes in order
   *
   * Before binding anything it captures pixi's current binding (the canvas, or a 2D filter's
   * texture) and runs every pass's `prepare`; at the end it binds that capture again. It never
   * pushes or pops pixi's render-target stack. For each pass it then:
   *  1. Takes the transients the pass is first to use from pixi's `TexturePool`, relabelled so a
   *     GPU capture names what each holds now.
   *  2. Binds the pass's render target, unless it is already bound. A pass on the view's own
   *     target binds the captured surface at the view camera's frame, and pixi works out the
   *     inset viewport and projection from that. This bind never clears: the colour carries the 2D
   *     content beneath, `DepthClearPass` resets the view's depth, and a clear would stop pixi
   *     reusing the open WebGPU render pass, which is how several views over one surface share
   *     one. Any other target binds at its texture's frame, with the clear its first writer asks
   *     for; clearing the scene depth spends {@link RenderSession#needsDepthClear}.
   *  3. Binds the textures the pass samples, before `render`, so the WebGPU bundles it records
   *     capture them. When a sampled texture changes, as when a pooled transient comes back as a
   *     different texture, the pass's bundles re-record.
   *  4. Runs `render`. For a pass with its own camera and a target the graph bound, the GPU
   *     viewport and `session.activeViewport` narrow to the camera's frame for the call, which
   *     saves binding again; a camera whose frame lands nowhere skips the pass. A pass with no
   *     attachments binds its own targets.
   *  5. Copies camera targets into their render textures, generates mipmaps for the colours the
   *     pass last wrote, and returns the transients it was last to use, so the pool's next request
   *     of the same kind gets the same texture.
   *
   * A transient binds with whichever `flipY` gives it the outer target's front-face winding:
   * cameras are built for the outer target, and on WebGL a texture target carries a y flip of its
   * own. A camera target binds with the outer `flipY` instead, so it is stored the way a render
   * texture is and the copy lands upright.
   *
   * `session.activeTarget` records the bound target across passes. Whatever closes or moves the
   * binding (a copy, the shadow pass, mipmap generation) clears it, so the next pass binds again.
   * @param session - The frame's render session.
   * @internal
   */
  public execute(session: RenderSession): void {
    this._maybeResetRenderTargetCache(session);
    this._repairDeadSampleSlots(session);
    this._prepareDefaultTarget(session);
    const renderer = session.renderer as WebGLRenderer | WebGPURenderer;
    const pipe = renderer.renderPipes.view3d;

    const savedBind = (this._savedBind = renderer.renderTarget.getBindState(this._savedBind));
    const defaultSurface = savedBind.target;
    const defaultFlipY = !!savedBind.flipY;

    const outerInverted = renderer.renderTarget.isFrontFaceInverted(session.defaultTarget, defaultFlipY);
    const transientFlipY = outerInverted !== (renderer.type === RendererType.WEBGL);

    for (let i = 0; i < this._activePasses.length; i++) {
      this._activePasses[i].pass.prepare?.(session);
    }

    for (let i = 0; i < this._activePasses.length; i++) {
      const ap = this._activePasses[i];
      const { pass, record } = ap;

      const toAcquire = this._acquireAt[i];
      for (let k = 0; k < toAcquire.length; k++) {
        const entry = this._resources[toAcquire[k]] as Extract<
          ResourceEntry,
          { /** Narrows to the transient entry variant */ kind: 'transient' }
        >;
        const desc = entry.describe(session);
        const texture = TexturePool.getOptimalTexture(desc);
        if (desc.label) texture.source.label = desc.label;
        entry.texture = texture;
      }

      const { target, flipY, frame } = this._resolveTarget(ap, session, transientFlipY, defaultFlipY);

      if (target === session.defaultTarget) {
        if (session.activeTarget !== target) {
          renderer.renderTarget.bind({
            target: defaultSurface,
            clear: CLEAR.NONE,
            frame: getCameraData(session.view3d.camera).frame,
            flipY: defaultFlipY,
          });
          session.activeTarget = target;
          session.activeViewport = session.viewport;
        }
      } else if (target !== null && target !== session.activeTarget) {
        const clear = this._resolveClear(record, i);
        renderer.renderTarget.bind({
          target,
          clear,
          frame: frame ?? undefined,
          flipY,
        });
        if ((clear & CLEAR.DEPTH) !== 0 && ap.depthHandle !== null && ap.depthHandle._id === this.sceneDepth._id) {
          session.needsDepthClear = false;
        }
        session.activeTarget = target;
        if (frame) {
          const resolution = (target.colorTexture?.source ?? target.depthStencilTexture!.source).resolution;
          session.activeViewport = toPhysicalRect(frame, resolution, _activeViewport);
        }
      }

      const sampleHandles = ap.sampleHandles;
      const sampleSlots = ap.sampleSlots;
      const lastSampleSourceUids = ap.lastSampleSourceUids;
      for (let j = 0; j < sampleHandles.length; j++) {
        const resolved = this._bindResource(sampleHandles[j], session);
        session.globalBindGroup.setResource(resolved, sampleSlots[j]);
        const r = resolved as {
          /** Present when the resolved binding is a `Texture` wrapper */
          source?: {
            /** Identity of the wrapped `TextureSource` */
            uid?: number;
          };
          /** Identity when the resolved binding is itself a `TextureSource` */
          uid?: number;
        } | null;
        const sourceUid = r?.source?.uid ?? r?.uid ?? -1;
        if (sourceUid !== lastSampleSourceUids[j]) {
          lastSampleSourceUids[j] = sourceUid;
          if (renderer.type === RendererType.WEBGPU && pass.bit !== undefined) {
            const batches = session.view3d._meshBatches;
            for (let b = 0; b < batches.length; b++) {
              const list = batches[b].drawLists[pass.bit];
              if (list) list.gpuData.bundleDirtyId++;
            }
          }
        }
      }

      const passCamera = target !== null && pass.camera && pass.camera !== session.view3d.camera ? pass.camera : null;
      const passViewport = passCamera && cameraFrameToPhysicalViewport(passCamera, session, session.activeViewport);

      if (passCamera === null) {
        pass.render(session);
      } else if (passViewport) {
        const restore = session.activeViewport;

        pipe.setViewport(passViewport);
        session.activeViewport = passViewport;

        pass.render(session);

        session.activeViewport = restore;
        pipe.setViewport(restore);
      }

      const copyCameras = ap.copyCameras;
      for (let k = 0; k < copyCameras.length; k++) {
        const camera = copyCameras[k];
        pipe.copyColor(this._drawTarget(camera, session), camera.renderTexture!, session);
      }

      const mipmapHandles = ap.mipmapHandles;
      for (let k = 0; k < mipmapHandles.length; k++) {
        const handle = mipmapHandles[k];
        if (this._texture(handle, session).source.autoGenerateMipmaps) pipe.generateMips(handle, session);
      }

      const toRelease = this._releaseAt[i];
      for (let k = 0; k < toRelease.length; k++) {
        const entry = this._resources[toRelease[k]] as Extract<
          ResourceEntry,
          { /** Narrows to the transient entry variant */ kind: 'transient' }
        >;
        TexturePool.returnTexture(entry.texture!);
        entry.texture = null;
      }
    }

    renderer.renderTarget.bind(savedBind);
    session.activeTarget = null;
  }

  /**
   * Asks every pass to give back the GPU memory it can rebuild lazily, the shadow map above all;
   * see {@link GraphRenderPass#unload}
   *
   * The graph itself keeps nothing to free here: transients are acquired and released inside a
   * single {@link RenderGraph#run}, so between frames it holds no pool slot. Idempotent, and the
   * graph keeps rendering afterwards.
   */
  public unload(): void {
    if (this._destroyed) return;

    for (let i = 0; i < this._passes.length; i++) {
      this._passes[i].pass.unload?.();
    }
  }

  /**
   * Release everything the graph exclusively owns: its passes, its render-target cache, and the
   * per-handle `Texture` / `TextureView` wrappers it minted
   *
   * Shared inputs (imported swap-chain / depth sources) are left intact. Pixi's texture pool is
   * not cleared here. Idempotent.
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    for (let i = 0; i < this._passes.length; i++) {
      this._passes[i].pass.destroy?.();
    }

    this._renderTargetCache.destroy();

    for (let i = 0; i < this._resources.length; i++) {
      const entry = this._resources[i];
      if (entry.cachedTexture) {
        entry.cachedTexture.destroy(false);
        entry.cachedTexture = null;
      }
      if (entry.cachedDepthView) {
        entry.cachedDepthView.destroy();
        entry.cachedDepthView = null;
        entry.cachedDepthViewSource = null;
      }
    }

    this._resources.length = 0;
    this._passes.length = 0;
    this._activePasses.length = 0;
    this._cameraTargets.clear();
    this._cameraTargetColors.clear();
    this._sceneDrawTarget = null;
  }

  /**
   * Resolve a handle to a `BindResource`
   *
   * Color handles return the raw `TextureSource`; depth handles return a cached
   * `TextureView({ aspect: 'depth-only' })` — WebGPU's `texture_depth_2d`
   * binding rejects a raw depth-stencil source.
   * @param handle - The resource to bind
   * @param session - The frame's render session, for imported getters
   */
  private _bindResource(handle: ResourceHandle, session: RenderSession): BindResource {
    const source = this._texture(handle, session).source;
    if (handle._kind !== 'depth') return source;
    const entry = this._resources[handle._id];
    if (entry.cachedDepthViewSource !== source) {
      entry.cachedDepthView?.destroy();
      entry.cachedDepthView = new TextureView(source, { aspect: 'depth-only' });
      entry.cachedDepthViewSource = source;
    }
    return entry.cachedDepthView!;
  }

  /**
   * Resolve a handle to its live `Texture`
   *
   * A transient is the pooled texture it holds. An imported `Texture` is used as it is, frame and
   * all, since a camera's render texture can be a frame of a larger source and its copy lands in
   * that frame. An imported bare source is wrapped once per source.
   * @param handle - The resource to wrap
   * @param session - The frame's render session, for imported getters
   * @internal
   */
  public _texture(handle: ResourceHandle, session: RenderSession): Texture {
    const entry = this._resources[handle._id];
    if (entry.kind === 'transient') {
      if (entry.texture === null) {
        throw new Error(`RenderGraph._texture: transient resource ${handle._id} has not been allocated`);
      }
      return entry.texture;
    }
    const imported = entry.getter(session);
    if (imported instanceof Texture) return imported;
    const source = imported.source;
    if (!entry.cachedTexture || entry.cachedTexture.source !== source) {
      entry.cachedTexture?.destroy(false);
      entry.cachedTexture = new Texture({ source });
    }
    return entry.cachedTexture;
  }

  /**
   * The raw `TextureSource` an attachment entry resolves to this frame
   *
   * `_resolveTarget` patches the attachment shape from it; the transient's `frame` is read off
   * the same entry, so the lookup happens once per attachment.
   * @param entry - The resource entry to resolve
   * @param session - The frame's render session, for imported getters
   * @returns The source bound for this attachment this frame
   */
  private _attachmentSource(entry: ResourceEntry, session: RenderSession): TextureSource {
    if (entry.kind === 'imported') return entry.getter(session).source;
    if (entry.texture === null) {
      throw new Error('RenderGraph._resolveTarget: a transient attachment has not been allocated');
    }
    return entry.texture.source;
  }

  /**
   * The source a resource holds right now, or `null` for a transient outside its lifetime
   * @param entry - The resource.
   * @param session - The frame's render session.
   * @returns Its source, or `null` when unallocated.
   */
  private _liveSource(entry: ResourceEntry, session: RenderSession): TextureSource | null {
    if (entry.kind === 'transient' && entry.texture === null) return null;
    return this._attachmentSource(entry, session);
  }

  private _importResource(type: ResourceKind, getter: (s: RenderSession) => BindableTexture): ResourceHandle {
    const id = this._resources.length;
    this._resources.push({
      kind: 'imported',
      type,
      getter,
      cachedTexture: null,
      cachedDepthView: null,
      cachedDepthViewSource: null,
    });
    return { _kind: type, _id: id };
  }

  private _createTransient(type: ResourceKind, describe: (s: RenderSession) => ResourceDescriptor): ResourceHandle {
    const id = this._resources.length;
    this._resources.push({
      kind: 'transient',
      type,
      describe,
      texture: null,
      cachedTexture: null,
      cachedDepthView: null,
      cachedDepthViewSource: null,
    });
    return { _kind: type, _id: id };
  }

  /**
   * Pick the render target for this pass
   *
   * Always writes `_resolvedTarget`, with a `null` target for a pass with no attachments, so a
   * previous pass's target can't leak into it; such a pass binds its own targets.
   *
   * `frame` is the content rect of the first colour, or else the first transient depth: a pass
   * writes one content rect. It is refreshed every call, because a pooled source can come back
   * with a different content size.
   *
   * `attachments` doubles as last frame's snapshot: its `texture` fields hold the sources
   * `_attachmentSource()` returned last time. When none changed and `cachedTarget` is set, the
   * cached target is reused with no cache lookup and no key string, which is the steady state:
   * same swap-chain texture, same pooled transients, same filter texture. The comparison catches
   * a resize, a swap-chain swap, a pool clear, a descriptor change and a filter toggle, and the
   * first frame, whose `Texture.EMPTY` placeholders from `compile()` match nothing. It misses a
   * reset of the render-target cache, which destroys every target the cache created while pooled
   * sources keep their identity, so `_invalidatePerPassTargets` drops the cached targets then.
   * @param ap - The pass whose attachments are resolved
   * @param session - The frame's render session
   * @param transientFlipY - `flipY` for a pooled attachment target.
   * @param defaultFlipY - `flipY` for an imported attachment target.
   * @returns The reused resolved-target record, filled for this pass
   */
  private _resolveTarget(
    ap: AddedPass,
    session: RenderSession,
    transientFlipY: boolean,
    defaultFlipY: boolean,
  ): ResolvedTarget {
    const out = _resolvedTarget;
    const attachments = ap.attachments;
    if (attachments === null) {
      out.target = null;
      out.flipY = defaultFlipY;
      out.frame = null;
      return out;
    }

    const colorHandles = ap.colorHandles;
    let changed = false;
    let frame: Rectangle | null = null;
    let flipY = defaultFlipY;

    if (attachments.colors) {
      for (let i = 0; i < colorHandles.length; i++) {
        const id = colorHandles[i]._id;
        const entry = this._resources[id];
        const source = this._attachmentSource(entry, session);
        if (frame === null && entry.kind === 'transient') {
          frame = entry.texture!.frame;
          flipY = this._cameraTargetColors.has(id) ? defaultFlipY : transientFlipY;
        }
        if (attachments.colors[i].texture !== source) {
          attachments.colors[i].texture = source;
          changed = true;
        }
      }
    }

    if (ap.depthHandle !== null) {
      const entry = this._resources[ap.depthHandle._id];
      const source = this._attachmentSource(entry, session);
      if (frame === null && entry.kind === 'transient') {
        frame = entry.texture!.frame;
        flipY = transientFlipY;
      }
      if (attachments.depth!.texture !== source) {
        attachments.depth!.texture = source;
        changed = true;
      }
    }

    out.flipY = flipY;
    out.target = !changed && ap.cachedTarget !== null ? ap.cachedTarget : this._renderTargetCache.get(attachments);
    ap.cachedTarget = out.target;
    out.frame = frame;
    return out;
  }

  /**
   * Write the bounds a tap on this input may reach, in its own texture's UV
   *
   * `(min.x, min.y, max.x, max.y)`, inset half a texel from the content's edge, which is what
   * lets a sampler replicate that edge the way the hardware would on a texture with no padding
   * instead of reading whatever the pool's previous tenant left there. The content's extent in
   * the texture is `min + max`, so callers need nothing else to map content UV onto it. Pixi hands
   * its filters the same rect as `uInputClamp`.
   *
   * Per input, because a transient created at a `resolution` other than the view's rounds up to a
   * different pooled texture size than the view-sized ones do. Transients only: an effect's input
   * is always one, and an imported source has no frame of its own to read.
   * @param handle - The transient about to be sampled.
   * @param session - The frame's render session.
   * @param out - Four-element destination for the rect.
   * @internal
   */
  public _inputClamp(handle: ResourceHandle, session: RenderSession, out: Float32Array): void {
    if (this._resources[handle._id].kind !== 'transient') {
      throw new Error(`RenderGraph._inputClamp: resource ${handle._id} is imported, not a transient`);
    }
    const { frame, source } = this._texture(handle, session);
    const halfX = 0.5 / source.pixelWidth;
    const halfY = 0.5 / source.pixelHeight;
    out[0] = halfX;
    out[1] = halfY;
    out[2] = frame.width / source.pixelWidth - halfX;
    out[3] = frame.height / source.pixelHeight - halfY;
  }

  /**
   * Drop the cached `RenderTarget` ref on every pass and every draw target
   *
   * Only `_maybeResetRenderTargetCache` calls this, after it resets the render-target cache. The
   * reset destroys every target the cache created. A pooled source keeps its identity across the
   * reset, so a pass or a draw target on pooled sources would pass its source check and keep a
   * destroyed target.
   */
  private _invalidatePerPassTargets(): void {
    for (let i = 0; i < this._passes.length; i++) this._passes[i].cachedTarget = null;
    for (const cameraTarget of this._cameraTargets.values()) cameraTarget.draw = null;
    this._sceneDrawTarget = null;
  }

  /**
   * Materialise `session.defaultTarget`'s depth and register it in the render-target cache
   *
   * Keyed by the live colour + depth sources, with and without read-only depth, so every
   * default-attachment pass resolves to pixi's own target rather than a parallel `RenderTarget`
   * wrapping the same textures: on WebGPU, initialising a second target over the canvas
   * reconfigures its context, which destroys the swap-chain texture the frame has already drawn
   * into. Ensure the depth-stencil *before* seeding the keys so they match what `_resolveTarget`
   * builds. `activeTarget` is left null — the first default-target pass establishes the binding
   * in `execute`. Re-seeds only when a source changed: the cache is emptied only on that same
   * change, so an unchanged key is still registered.
   * @param session - The frame's render session, which owns the default target
   */
  private _prepareDefaultTarget(session: RenderSession): void {
    session.defaultTarget.ensureDepthStencilTexture();

    const color = session.defaultTarget.colorTexture.source;
    const depth = session.defaultTarget.depthStencilTexture!.source;
    const key = this._defaultCacheKey;
    if (key.colors![0].texture === color && key.depth!.texture === depth) return;

    key.colors![0].texture = color;
    key.depth!.texture = depth;
    this._renderTargetCache.addToCache(key, session.defaultTarget);
    this._renderTargetCache.addToCache(this._defaultCacheKeyReadOnlyDepth, session.defaultTarget);
  }

  /**
   * Folded clear flag for the target `bind`, derived from `_effectiveLoadOp` over every
   * `write_attachment` access
   * @param record - The pass whose `write_attachment` accesses are folded
   * @param passIdx - The pass's index, matched against each resource's first writer
   */
  private _resolveClear(record: PassRecord, passIdx: number): CLEAR {
    let clearColor = false;
    let clearDepth = false;
    for (let i = 0; i < record.accesses.length; i++) {
      const access = record.accesses[i];
      if (access.mode !== 'write_attachment') continue;
      if (this._effectiveLoadOp(access, passIdx) !== 'clear') continue;
      if (access.handle._kind === 'color') clearColor = true;
      else if (access.handle._kind === 'depth') clearDepth = true;
    }

    if (clearColor && clearDepth) return CLEAR.ALL;
    if (clearColor) return CLEAR.COLOR;
    if (clearDepth) return CLEAR.DEPTH;
    return CLEAR.NONE;
  }

  /**
   * Inferred loadOp for a write access
   *
   * Only binds of targets other than the view's own default target use it, since `execute` never
   * clears that one. Rules in priority order:
   *
   *  - subsequent writer (not the first of the frame) → `'load'` (never
   *    wipe a prior writer's output)
   *  - first writer, transient handle → `'clear'` (pooled sources carry
   *    stale content from prior aliases / frames)
   *  - first writer, imported default depth → `'clear'` (per-frame depth
   *    reset)
   *  - first writer, any other imported → `'load'` (caller-owned content,
   *    including the default colour beneath any 2D UI)
   * @param access - The write access to resolve
   * @param passIdx - The writing pass's index, matched against the resource's first writer
   */
  private _effectiveLoadOp(access: ResourceAccess, passIdx: number): 'load' | 'clear' {
    const id = access.handle._id;
    if (this._firstWriterByResId[id] !== passIdx) return 'load';
    const entry = this._resources[id];
    if (entry.kind === 'transient') return 'clear';
    if (id === this.defaultDepth._id) return 'clear';
    return 'load';
  }

  /**
   * On a default-attachment uid change (swap-chain swap / filter target swap), tear down the
   * render-target cache
   *
   * A uid of `-1` means not seen yet. This runs before `_prepareDefaultTarget` creates the default
   * depth, so the first frame sees no depth, and skipping comparisons against `-1` keeps that
   * first appearance from reading as a swap.
   * @param session - The frame's render session, whose default attachments are compared with last frame's
   */
  private _maybeResetRenderTargetCache(session: RenderSession): void {
    const colorTex = session.defaultTarget.colorTexture.source;
    const depthTex = session.defaultTarget.depthStencilTexture?.source;
    const colorUid = colorTex.uid;
    const depthUid = depthTex ? depthTex.uid : -1;
    const colorChanged = this._lastColorUid !== -1 && colorUid !== this._lastColorUid;
    const depthChanged = this._lastDepthUid !== -1 && depthUid !== this._lastDepthUid;
    if (colorChanged || depthChanged) {
      this._renderTargetCache.reset();
      this._invalidatePerPassTargets();
    }
    this._lastColorUid = colorUid;
    this._lastDepthUid = depthUid;
  }

  /**
   * Repair any transient sample slot whose texture the pool has destroyed
   *
   * A pass that did not run this frame still owns slots in the view's global bind group, and the
   * pool may destroy the idle texture they point at (a canvas resize destroys idle textures sized
   * to the old canvas). Pixi nulls such a slot; a depth view reports its source as destroyed. Either
   * way the slot goes back to its placeholder, a depth-only view for a depth slot and an empty
   * source for a colour slot, and on WebGPU the view's bundles re-record, since they baked the
   * bind group that held the dead texture. Runs at execute start, before any bind; the steady
   * state touches nothing.
   * @param session - The frame's render session, whose global bind group is checked
   */
  private _repairDeadSampleSlots(session: RenderSession): void {
    let repaired = false;
    for (let i = 0; i < this._passes.length; i++) {
      const accesses = this._passes[i].record.accesses;
      for (let j = 0; j < accesses.length; j++) {
        const a = accesses[j];
        if (a.mode !== 'sample' || this._resources[a.handle._id].kind !== 'transient') continue;
        const bound = session.globalBindGroup.getResource(a.slot!);
        if (bound !== null && !bound.destroyed) continue;
        const placeholder = a.handle._kind === 'depth' ? DEPTH_VIEW_PLACEHOLDER : Texture.EMPTY.source;
        session.globalBindGroup.setResource(placeholder, a.slot!);
        repaired = true;
      }
    }
    if (repaired && session.renderer.type === RendererType.WEBGPU) {
      const batches = session.view3d._meshBatches;
      for (let b = 0; b < batches.length; b++) batches[b].invalidateBundleCaches();
    }
  }
}
