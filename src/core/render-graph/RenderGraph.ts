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
import { prepareCamera } from '../prepareCamera';
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

/**
 * Expand transient options into the per-frame descriptor the pool consumes
 *
 * Pixi's rule: texels = logical size × resolution. The logical size defaults to the view's
 * viewport (physical viewport over the target's resolution) and the resolution to the target's
 * own, so `{}` is the physical viewport and `resolution: 1` is one texel per logical pixel. The
 * size asked for here is the content size; the pool decides the texture it sits in, and the
 * resulting `frame` is what consumers map through. Fields left unset fall back to what the
 * view's target uses.
 * @param type - Colour or depth; picks the default format, label and sampling
 * @param options - The caller's transient texture options
 */
function toDescribe(type: ResourceKind, options: TransientTextureOptions): (s: RenderSession) => ResourceDescriptor {
  const depth = type === 'depth';
  const scaleMode = options.scaleMode ?? (depth ? 'nearest' : undefined);
  return (s: RenderSession) => {
    const source = s.defaultTarget.colorTexture.source;
    const targetResolution = source.resolution;
    const resolution =
      options.resolution === undefined || options.resolution === 'inherit' ? targetResolution : options.resolution;
    const width = options.width ?? s.viewport.width / targetResolution;
    const height = options.height ?? s.viewport.height / targetResolution;
    const descriptor: ResourceDescriptor = {
      width: Math.max(1, Math.round(width * resolution)),
      height: Math.max(1, Math.round(height * resolution)),
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

/** Offscreen bind, in texels — `session.activeViewport` points here */
const _activeViewport = new Rectangle();
const _resolvedTarget: ResolvedTarget = { target: null, flipY: false, frame: null };

/**
 * What a camera with a render texture draws into, and where the picture ends up
 *
 * The passes write the target — a colour and depth transient pair sized from the texture —
 * and the graph copies it into the texture after the camera's last pass. The texture is
 * never an attachment, so a mesh in the same view can sample it while the camera draws: it
 * reads last frame's picture. Reached only through the builder's `targetColor` /
 * `targetDepth` and the executor's copy.
 * @internal
 */
interface CameraTarget {
  /** Colour the camera's passes write, pooled, the size of the texture's frame */
  color: ColorHandle;
  /** Depth paired with `color` */
  depth: DepthHandle;
  /** The camera's {@link Camera3D#renderTexture}, imported: the copy's destination */
  texture: ColorHandle;
}

/**
 * A resource in the graph's resource table — either externally owned
 * (`imported`, resolved each frame via `getter`) or graph-allocated
 * (`transient`, acquired/released around its first and last use)
 *
 * `cachedTexture` and `cachedDepthView` are per-handle wrapper caches
 * invalidated by `TextureSource` identity — the outgoing wrapper is destroyed
 * on swap, never just dropped: each one holds a `resize` listener on its
 * source, and pooled transient sources outlive their wrappers, so a dropped
 * wrapper would stay pinned to the pool forever. A transient's wrapper
 * survives the per-frame release on purpose; the steady state re-acquires the
 * same pooled source and reuses the wrapper allocation-free. The depth view
 * exists because WebGPU's `texture_depth_2d` binding rejects a raw
 * depth-stencil source.
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
  /** Passes this one reads or follows in a write-after-write chain — set by `compile()` */
  dependsOn: AddedPass[];
  /** Writes or produces an imported resource — seeds the refcount cull in `resolve()` */
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
   * it yet. That is the whole of mipmap generation in the graph — the flag on the texture is
   * the declaration, and no pass says "mipmaps".
   */
  mipmapHandles: ColorHandle[];
  /**
   * Pre-built attachment shape for `_renderTargetCache.get`
   *
   * Shape is fixed at compile time; `texture` fields are patched each frame in
   * `_resolveTarget`. `null` for transfer-only passes (no attachment
   * writes) — the executor skips the target push and `pass.render()`
   * self-manages.
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
   * When it changes — e.g. a pooled transient swaps instances as the viewport crosses
   * a power-of-two bucket — the consuming pass is forced to rebuild, so a
   * cached WebGPU render bundle can't keep sampling the stale (record-time)
   * texture. Parallel to `sampleHandles`; `-1` = not yet bound.
   */
  lastSampleSourceUids: number[];
  /**
   * Cached `RenderTarget` from the last `_resolveTarget` call
   *
   * Validated each frame by source-identity diff against the `texture` fields stored
   * in `attachments` (which double as the previous-frame snapshot — see
   * `_resolveTarget`). A mismatch (resize, swap-chain swap, transient
   * realloc, filter target swap) re-queries `_renderTargetCache`. Also
   * explicitly invalidated by `_invalidatePerPassTargets` when the global
   * cache is mutated under a stable source identity (first-frame default
   * depth materialisation, swap-chain reset).
   */
  cachedTarget: RenderTarget | null;
  /**
   * Allocation-free membership marks for the `resolve()` cull
   *
   * Compared against the graph-level `_resolveTick` that bumps each frame:
   * `candidateTick === tick` ⇔ pass survived this frame's `condition()`;
   * `neededTick === tick` ⇔ pass survived the refcount cull. Stale marks
   * from prior frames are naturally invalid against the new tick.
   */
  candidateTick: number;
  neededTick: number;
}

/**
 * Construction options for {@link RenderGraph}
 *
 * The default-attachment getters are resolved each frame so the graph picks up
 * swap-chain / resize swaps transparently.
 * @category rendering
 * @advanced
 */
export interface RenderGraphOptions {
  /** Resolves the View's default (screen) colour attachment for the frame */
  defaultColor: (session: RenderSession) => BindableTexture;
  /** Resolves the View's default (screen) depth attachment for the frame */
  defaultDepth: (session: RenderSession) => BindableTexture;
  /**
   * Composite mode: describe the colour + depth transient the scene accumulates
   * into (an output pass then blits it to the default target). Omit both for
   * direct mode, where the scene targets *are* the default (screen) targets.
   */
  sceneColor?: TransientTextureOptions;
  /** Depth counterpart of {@link RenderGraphOptions#sceneColor} — provide both or neither */
  sceneDepth?: TransientTextureOptions;
}

/**
 * Resource-centric render graph
 *
 * Passes declare reads/writes/samples via `setup(builder)`; the graph derives dependency edges,
 * validates hazards, and per frame culls passes whose outputs nobody observes.
 *
 * Lifecycle: `addPass` → `compile()` (once) → per-frame `run(session)`
 * (`resolve` + `prepare` + `execute`).
 * @category rendering
 * @advanced
 */
export class RenderGraph {
  private readonly _resources: ResourceEntry[] = [];
  private readonly _passes: AddedPass[] = [];

  /** Single recording builder shared across every pass's `setup()` call */
  private readonly _builder: PassBuilder;

  /** Render targets keyed by attachment uids — reset on attachment-source-uid change */
  private readonly _renderTargetCache: RenderTargetCache = new RenderTargetCache();

  /**
   * Reusable shape for seeding `session.defaultTarget` into the cache each
   * frame; mutated in place by `_prepareDefaultTarget`
   *
   * EMPTY placeholders are overwritten with the live default-target sources before lookup.
   */
  private readonly _defaultCacheKey: PassAttachments = {
    colors: [{ texture: Texture.EMPTY.source }],
    depth: { texture: Texture.EMPTY.source },
  };

  /**
   * Target and texture per camera with a render texture
   *
   * Minted by `RenderGraph._cameraTarget` on the first pass that names the camera.
   */
  private readonly _cameraTargets = new Map<Camera3D, CameraTarget>();

  /** Scratch for `resolve`'s back-to-front camera walk */
  private readonly _camerasSeen = new Set<Camera3D>();

  /**
   * Ids of every camera target's colour transient
   *
   * Two things set a camera target apart from other transients. Its writers are anchored like
   * writers of an imported resource: the executor copies it into the camera's texture, so its
   * output is observed, just not through a pass access the refcount cull could see. And it binds
   * with the outer binding's `flipY` rather than the composite reconciliation, so it is stored
   * the way a render texture is and the copy lands the right way up.
   */
  private readonly _cameraTargetColors = new Set<number>();

  /**
   * Canonical colour target scene passes write — what `b.targetColor` resolves to for a pass
   * drawing the view
   *
   * The scene pair is the default (screen) pair in direct mode, or a dedicated transient in
   * composite mode (from `RenderGraphOptions.sceneColor`/`sceneDepth`). Fixed at construction.
   */
  public readonly sceneColor: ColorHandle;
  /** Depth target paired with {@link RenderGraph#sceneColor} */
  public readonly sceneDepth: DepthHandle;
  /** The View's default (screen) colour attachment — its final output */
  public readonly defaultColor: ColorHandle;
  /** Depth attachment paired with {@link RenderGraph#defaultColor} */
  public readonly defaultDepth: DepthHandle;

  /** Last frame's default-attachment uids; drives the cache reset on resize / swap-chain swap */
  private _lastColorUid = -1;
  private _lastDepthUid = -1;

  /** Passes that survived this frame's condition + refcount cull, in declaration order */
  private readonly _activePasses: AddedPass[] = [];

  /** Transient ids to acquire before pass `i`'s target push — rebuilt each `resolve()` */
  private readonly _acquireAt: number[][] = [];

  /** Transient ids to release after pass `i`'s `render()` returns — rebuilt each `resolve()` */
  private readonly _releaseAt: number[][] = [];

  /**
   * Per-resource lifetime endpoints + first-writer index for the current
   * frame, indexed by `handle._id` (dense ints starting at 0)
   *
   * `-1` means "untouched this frame". Grown on demand to `_resources.length`,
   * `fill(-1)` each `resolve()` — no per-frame object allocation. Consumed
   * by the schedule emit loop in `resolve()` and by `_effectiveLoadOp`.
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
   * checks during the cull. Safe-integer space; at 60fps, overflow is millennia away.
   */
  private _resolveTick = 0;

  /** Reused scratch: survivors of `condition()` and the DFS stack for the cull */
  private readonly _resolveCandidates: AddedPass[] = [];
  private readonly _resolveStack: AddedPass[] = [];

  /**
   * Reused capture of the binding live at `execute` entry (filter surface /
   * canvas, its frame, orientation, subresource)
   *
   * Replayed at exit so sibling 2D / other View3Ds inherit the exact original binding.
   */
  private _savedBind?: BindOptions;

  /** Re-entry guard for `destroy` */
  private _destroyed = false;

  constructor(opts: RenderGraphOptions) {
    this.defaultColor = this.importColor(opts.defaultColor);
    this.defaultDepth = this.importDepth(opts.defaultDepth);
    // Composite (opts.sceneColor/Depth provided): the scene accumulates into its
    // own transient and an output pass blits it to the default. Direct (omitted):
    // the scene targets are the default (screen) targets. Fixed at construction.
    this.sceneColor = opts.sceneColor ? this.createColor(opts.sceneColor) : this.defaultColor;
    this.sceneDepth = opts.sceneDepth ? this.createDepth(opts.sceneDepth) : this.defaultDepth;
    this._builder = new PassBuilder(this);
  }

  // --- Imported resources (anchors — their writers always survive the cull) ---

  /**
   * Register an externally owned color texture
   *
   * The getter runs each frame so the graph follows texture-identity changes
   * (resize / swap-chain reacquisition) without re-registration.
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

  // --- Transient resources (graph-allocated, pooled within a frame) ---

  /**
   * Register a graph-allocated color texture
   *
   * The descriptor runs each frame so the texture can follow a moving size; the graph
   * reallocates only on descriptor change, and non-overlapping transients share pooled sources.
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

  // --- Camera targets ---

  /**
   * The target a pass drawing from `camera` writes — what the builder seeds `targetColor` /
   * `targetDepth` with for a pass on a camera with a render texture — and the texture it is
   * copied into
   *
   * The target is a pooled colour + depth pair described from the texture each frame, so a
   * resized or swapped texture is followed without a rebuild, in the texture's own format so
   * the copy is texel for texel. As a transient, its first writer clears it. The copy runs
   * after the camera's last active pass (`resolve` finds it, `execute` does it).
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
    };
    this._cameraTargetColors.add(target.color._id);

    this._cameraTargets.set(camera, target);

    return target;
  }

  // --- Passes ---

  /** Passes in declaration order — freshly materialised so callers can keep the result */
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

  // --- Lifecycle ---

  /**
   * Static analysis of every pass's accesses
   *
   * Per pass:
   *  - `dependsOn` — writer of any sampled / read / re-written handle id.
   *  - `isAnchored` — writes or produces an imported resource, or a camera target the executor copies.
   *  - `attachments` — reusable `PassAttachments` shape (or `null` for
   *    transfer-only passes); per-frame `_resolveTarget` patches the
   *    texture fields before cache lookup.
   *
   * Read-edges resolve against the most-recent writer in declaration order
   * (no snapshot reads). Throws if a pass both writes and samples/reads the
   * same handle id.
   */
  public compile(): void {
    // Reset compile-time state — compile() is idempotent.
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
      // The attachment shape is rebuilt below; the per-pass target cache
      // is tied to it, so reset to force a clean lookup on the next frame.
      ap.cachedTarget = null;
    }

    // Per-handle-id: every writer pass so far, in declaration order. A read
    // depends on all of them (see the read-edge block), not just the last.
    const writersById: Record<number, AddedPass[]> = Object.create(null);

    for (let i = 0; i < this._passes.length; i++) {
      const ap = this._passes[i];
      const accesses = ap.record.accesses;

      // One walk: dependency edges, anchoring, attachment shape, and the
      // single-pass hazard check (same id written and read/sampled). Pass
      // sizes are small, so the inline O(n²) hazard scan beats allocating
      // a Set per pass.
      let hasAttachment = false;
      let depthReadOnly = false;

      for (let j = 0; j < accesses.length; j++) {
        const a = accesses[j];
        const id = a.handle._id;

        if (a.mode === 'write_attachment' || a.mode === 'produce') {
          // Write-after-write edge to the immediately preceding writer.
          const writers = writersById[id] ?? (writersById[id] = []);
          const prev = writers[writers.length - 1];
          if (prev && prev !== ap && !ap.dependsOn.includes(prev)) {
            ap.dependsOn.push(prev);
          }
          writers.push(ap);

          if (this._resources[id].kind === 'imported' || this._cameraTargetColors.has(id)) ap.isAnchored = true;
        } else {
          // sample / read / read_attachment — read-side edge + hazard check.
          // Same id may not also be written in this pass.
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

          // Read-after-write edges — depend on EVERY prior writer, not just the
          // last. A multiply-written attachment (the composite scene colour:
          // cleared by DepthClear, then drawn by Background / Opaque / Transparent)
          // needs all its writers kept. The WAW chain alone severs when an
          // intermediate writer is condition-culled (e.g. Transmission with no
          // glass), dropping every writer upstream of it.
          const writers = writersById[id];
          if (writers) {
            for (let w = 0; w < writers.length; w++) {
              const writer = writers[w];
              if (writer !== ap && !ap.dependsOn.includes(writer)) ap.dependsOn.push(writer);
            }
          }

          // Pre-extract sample binds so the executor walks only the slots
          // it actually has to set — most attachment-only passes have zero.
          if (a.mode === 'sample') {
            ap.sampleHandles.push(a.handle);
            ap.sampleSlots.push(a.slot!);
            ap.lastSampleSourceUids.push(-1);
          }
        }

        // Attachment shape — only `write_attachment` and `read_attachment`
        // define the target. The builder only ever produces depth
        // `read_attachment` (via `readDepthAttachment`), so the read path
        // is depth-only by construction.
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

      // Build the reusable shape once; `texture` fields are patched per frame.
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
   * Run this frame: {@link RenderGraph#resolve}, {@link RenderGraph#prepareCameras},
   * {@link RenderGraph#execute}
   *
   * The graph's three steps, in the only order they work in: pick the passes, build the cameras
   * those passes need, draw. Everything that is true of the view whatever the pass list says is
   * already settled before this is called: its own camera by the scene update, its lights and
   * globals by the pipe's `prepareView`. The three stay public for tests that only cull.
   * @param session - The frame's render session.
   */
  public run(session: RenderSession): void {
    this.resolve(session);
    this.prepareCameras(session);
    this.execute(session);
  }

  /**
   * Per-frame pass selection
   *
   *  1. Drop passes whose optional `condition(session)` returns false.
   *  2. Refcount cull — keep only what's reachable backward through
   *     `dependsOn` from anchored passes. Survivors are emitted in
   *     declaration order.
   *
   * Also builds the transient acquire/release schedule and the first-writer
   * map for `_effectiveLoadOp`.
   * @param session - The frame's render session.
   */
  public resolve(session: RenderSession): void {
    this._activePasses.length = 0;

    const tick = ++this._resolveTick;

    // Stage 1: condition() filter. Mark survivors with the frame's tick;
    // membership in the candidate set is `ap.candidateTick === tick`.
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

    // Stage 2: refcount cull — flood-fill backward from anchored passes.
    // A dependency that itself failed `condition()` doesn't extend the
    // survival set (its output isn't produced; downstream consumers sample
    // stale data this frame — caller's contract).
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
        // Skip deps that failed condition() or are already in the survival set.
        if (dep.candidateTick !== tick || dep.neededTick === tick) continue;
        dep.neededTick = tick;
        stack.push(dep);
      }
    }

    // Emit survivors in declaration order.
    for (let i = 0; i < this._passes.length; i++) {
      const ap = this._passes[i];
      if (ap.neededTick === tick) this._activePasses.push(ap);
    }

    // Lifetime schedule + writer maps. firstUse / lastUse drive transient
    // acquire/release in `execute()` so non-overlapping handles can share pooled
    // sources; firstWriterByResId drives the inferred loadOp in `_effectiveLoadOp`;
    // lastWriterByResId places each colour handle's mipmap generation after its final
    // writer. All persistent Int32Arrays indexed by `handle._id` (dense), `-1`
    // for "untouched this frame".
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

    // A camera's target is copied into its texture after its last active pass, whichever that is
    // this frame. Back to front, so the first sighting of a camera is that pass. The texture
    // joins that pass's mipmap handles: the copy runs first, so mipmaps come from the picture.
    const seen = this._camerasSeen;
    seen.clear();
    for (let i = n - 1; i >= 0; i--) {
      const ap = this._activePasses[i];
      const camera = ap.pass.camera;
      if (!camera?.renderTexture || seen.has(camera)) continue;
      seen.add(camera);
      ap.copyCameras.push(camera);
      ap.mipmapHandles.push(this._cameraTarget(camera).texture);
    }
  }

  /**
   * Build the camera of every pass that survived {@link RenderGraph#resolve}
   *
   * Only pass cameras: the view's own is the pipe's, built before `resolve` so a pass's
   * `condition` can ask about this frame. `prepareCamera` stamps the session, so a camera
   * two passes name is built once and the view camera's entry here is a no-op.
   *
   * Runs before any render target is bound, so every camera reads the same winding off the same
   * binding. Call after {@link RenderGraph#resolve}, before {@link RenderGraph#execute}.
   * @param session - The frame's render session.
   */
  public prepareCameras(session: RenderSession): void {
    for (let i = 0; i < this._activePasses.length; i++) {
      const camera = this._activePasses[i].pass.camera;
      if (camera) prepareCamera(camera, session);
    }
  }

  /**
   * Walk active passes and dispatch them (target selection: `_resolveTarget`)
   *
   * The graph borrows the live default-target binding and never touches pixi's
   * render-target stack. Default-target passes (re)establish it with
   * `bind(defaultSurface, NONE, frame)`: binding the framed surface lets pixi derive
   * the inset viewport + projection from the filter frame, and idempotent `bind`
   * lets many 3D insets weave into one open pass (keep-encoder-open). No clear —
   * colour loads (it carries 2D) and per-view depth is reset by `DepthClearPass`'s
   * draw, so a clear can't force a per-inset `beginRenderPass`.
   *
   * `session.activeTarget` records the live pass across passes; a self-managing pass
   * that closes or diverts it (`CopyOpaquePass`, the shadow pass) nulls it so the
   * next default-target pass re-establishes the binding.
   * @param session - The frame's render session.
   */
  public execute(session: RenderSession): void {
    this._maybeResetRenderTargetCache(session);
    this._repairDeadSampleSlots(session);
    this._prepareDefaultTarget(session);
    const renderer = session.renderer as WebGLRenderer | WebGPURenderer;
    const pipe = renderer.renderPipes.view3d;

    // The binding pixi had on entry (filter input texture / canvas, its frame and
    // Y-orientation). Captured up front — a self-managing pass can divert the live
    // binding mid-graph — and replayed at the end of the walk. Default-target passes
    // bind its surface (not the bare RenderTarget) so pixi derives the viewport /
    // projection from the filter frame. `_savedBind` is reused across frames;
    // getBindState overwrites every field.
    const savedBind = (this._savedBind = renderer.renderTarget.getBindState(this._savedBind));
    const defaultSurface = savedBind.target;
    const defaultFlipY = !!savedBind.flipY;

    // Winding reconciliation for transient binds. `prepareCamera` flips a camera's bound projection to
    // match the *outer* target's front face (for a camera without a render texture), but composite scene
    // passes draw into a non-root transient, which on WebGL carries its own inherent flip. So a transient
    // binds with whichever `flipY` lands it on the outer's resolved winding, and culling stays consistent
    // whatever the outer is.
    const outerInverted = renderer.renderTarget.isFrontFaceInverted(session.defaultTarget, defaultFlipY);
    const transientFlipY = outerInverted !== (renderer.type === RendererType.WEBGL);

    // Prepare sweep: every active pass uploads its draw data before any render target is bound, so
    // a cull compute can run with no render pass open. `prepareCameras` already built the cameras,
    // so the frustums those culls read are this frame's.
    for (let i = 0; i < this._activePasses.length; i++) {
      this._activePasses[i].pass.prepare?.(session);
    }

    for (let i = 0; i < this._activePasses.length; i++) {
      const ap = this._activePasses[i];
      const { pass, record } = ap;

      // Acquire firstUse transients before `_resolveTarget`, which reads their
      // `.source` / `.frame` while patching the attachment shape.
      const toAcquire = this._acquireAt[i];
      for (let k = 0; k < toAcquire.length; k++) {
        const entry = this._resources[toAcquire[k]] as Extract<
          ResourceEntry,
          { /** Narrows to the transient entry variant */ kind: 'transient' }
        >;
        const desc = entry.describe(session);
        // The descriptor is a pool request as it stands: content size, format, mips, scale mode.
        const texture = TexturePool.getOptimalTexture(desc);
        // Pooled sources are labelled by the pool that minted them; relabel to the current tenant
        // so a capture names what the texture is holding now rather than where it came from.
        if (desc.label) texture.source.label = desc.label;
        entry.texture = texture;
      }

      const { target, flipY, frame } = this._resolveTarget(ap, session, transientFlipY, defaultFlipY);

      if (target === session.defaultTarget) {
        // Bind the framed surface (pixi derives viewport/projection from the filter
        // frame), with the view camera's frame to narrow to the inset. No
        // clear: colour loads, depth is reset by `DepthClearPass`'s draw — a clear
        // would stop idempotent `bind` reusing the open pass and force a
        // `beginRenderPass` per inset, breaking the weave.
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
        // A non-default attachment target: the composite scene colour/depth, an effect chain
        // buffer, or a camera's target. Bind the texture's frame so the pass draws into the same
        // sub-rect consumers map back through. A transient is non-root, so it binds with
        // `transientFlipY` (WebGL winding reconciliation, see above); a camera target and an
        // imported target keep the outer `defaultFlipY`.
        const clear = this._resolveClear(record, i);
        renderer.renderTarget.bind({
          target,
          clear,
          frame: frame ?? undefined,
          flipY,
        });
        // A bind that just load-op-cleared the scene depth satisfies the per-view
        // depth reset — DepthClearPass spends the demand instead of re-clearing
        // (see RenderSession.needsDepthClear). Scoped to the scene depth so a
        // custom transient clearing its own depth can't falsely satisfy it.
        if ((clear & CLEAR.DEPTH) !== 0 && ap.depthHandle !== null && ap.depthHandle._id === this.sceneDepth._id) {
          session.needsDepthClear = false;
        }
        session.activeTarget = target;
        if (frame) {
          const resolution = (target.colorTexture?.source ?? target.depthStencilTexture!.source).resolution;
          _activeViewport.x = Math.round(frame.x * resolution);
          _activeViewport.y = Math.round(frame.y * resolution);
          _activeViewport.width = Math.max(1, Math.round(frame.width * resolution));
          _activeViewport.height = Math.max(1, Math.round(frame.height * resolution));
          session.activeViewport = _activeViewport;
        }
      }

      // Bind sample accesses after the target is set so bundles recorded
      // inside `pass.render()` capture the right bind-group state.
      // `sampleHandles` is pre-filtered at compile time; attachment-only
      // passes loop zero times here.
      const sampleHandles = ap.sampleHandles;
      const sampleSlots = ap.sampleSlots;
      const lastSampleSourceUids = ap.lastSampleSourceUids;
      for (let j = 0; j < sampleHandles.length; j++) {
        const resolved = this._bindResource(sampleHandles[j], session);
        session.globalBindGroup.setResource(resolved, sampleSlots[j]);
        // A cached WebGPU render bundle bakes this binding at record time. If
        // the underlying source changed since last frame — a pooled transient
        // swapping instances as the viewport crosses a power-of-two bucket —
        // invalidate each batch's bundle for this consuming pass so it can't
        // sample a stale texture. Draw commands stay valid. GL rebinds live.
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

      // A pass drawing from its own camera lands in that camera's frame. Save the bind rect,
      // narrow the GPU viewport, then put both back. Bind already set the viewport; this is
      // the bypass that avoids rebinding. Only for passes the executor bound a target for: a
      // self-managing pass (a copy on a texture camera) owns its GPU work and may close the pass
      // the viewport would be restored on.
      const passCamera = target !== null && pass.camera && pass.camera !== session.view3d.camera ? pass.camera : null;
      const passViewport = passCamera && cameraFrameToPhysicalViewport(passCamera, session);

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

      // A camera's target is complete once its last pass has drawn: copy it into the texture the
      // scene samples. It is still bound, and `copyColor` reads the bound target's live rect,
      // which is the whole of it.
      const copyCameras = ap.copyCameras;
      for (let k = 0; k < copyCameras.length; k++) {
        pipe.copyColor(this._cameraTarget(copyCameras[k]).texture, session);
      }

      // Every colour this pass finished writing is complete now, and nothing has sampled it
      // yet: generate mipmaps for any whose source asks for them. In-band, so on WebGPU the
      // generation is ordered on the frame encoder between this write and the next read.
      const mipmapHandles = ap.mipmapHandles;
      for (let k = 0; k < mipmapHandles.length; k++) {
        const handle = mipmapHandles[k];
        if (this._texture(handle, session).source.autoGenerateMipmaps) pipe.generateMips(handle, session);
      }

      // Release lastUse transients after `pass.render()` so the LIFO can
      // hand the slot to a later transient of the same descriptor.
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

    // Replay the entry binding so sibling 2D / other View3Ds inherit it exactly
    // (target, frame, orientation — the capture is non-destructive, clear = NONE).
    // Idempotent: a near-no-op unless a self-managing pass left the binding elsewhere.
    renderer.renderTarget.bind(savedBind);
    session.activeTarget = null;
  }

  /**
   * Asks every pass to give back the GPU memory it can rebuild lazily (see
   * {@link GraphRenderPass#unload}) — the shadow map above all
   *
   * The graph itself keeps nothing to free here: transients are acquired and released
   * inside a single {@link RenderGraph#execute}, so between frames it holds no pool
   * slot. Idempotent, and the graph keeps executing afterwards.
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

    // Graph-minted wrappers around shared/external sources — drop the wrappers
    // without destroying the sources beneath them.
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
  }

  // --- Internal ---

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
   * Resolve a handle to a live `Texture` wrapper
   *
   * Cached per handle and invalidated by `TextureSource` identity (resize / swap-chain swap /
   * transient reallocation).
   * @param handle - The resource to wrap
   * @param session - The frame's render session, for imported getters
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
    // An imported `Texture` is used as it is, frame and all — a camera's render texture may be a
    // frame of a larger source, and the copy lands in that frame. A bare source is wrapped
    // once per source identity.
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
   * Always writes `_resolvedTarget` — `null` target for transfer-only passes so a previous
   * pass's target cannot leak. The executor skips the push when `target` is `null` and
   * `pass.render()` self-manages.
   *
   * `frame` is the content rect of the first colour (else the first transient depth). A pass
   * writes one content rect. Refreshed every call — a pooled source can come back with a
   * different content size.
   *
   * **Steady-state fast path.** `attachments` doubles as the previous-frame
   * snapshot: its `texture` fields hold whatever sources `_attachmentSource()`
   * returned last time, so the diff is just `prev !== current`. If nothing
   * changed and `cachedTarget !== null`, the cached ref is reused —
   * zero `_renderTargetCache` lookup, zero string allocation. This is the
   * case 99% of frames hit: same swap-chain texture, same pooled
   * transients, same Pixi filter intermediate. `frame` is still written.
   *
   * On first frame the EMPTY-placeholder `attachments` built in `compile()`
   * mismatches the real source on every slot → falls through, populates
   * `attachments` with real sources, fills `cachedTarget`. From then on
   * the writes only fire on actual change, so the loop is read-only in
   * the hit case.
   *
   * **Invalidation.** Source-identity diffs catch every real case — resize
   * / swap-chain swap, transient pool clear, transient descriptor change,
   * filter target toggle — so the steady-state path needs no external help.
   * The first frame needs none either: the EMPTY-placeholder `attachments`
   * from `compile()` mismatch the real sources and force the lookup. On a
   * swap-chain / resize reset `_invalidatePerPassTargets` additionally drops
   * the cached refs — not for correctness (every uid changed, so the diff
   * already re-queries) but to release references to the torn-down targets.
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
   * Per input, because a transient created at a `resolution` other than the view's rounds into a
   * different pool bucket than the view-sized ones do. Transients only: an effect's input is
   * always one, and an imported source has no frame of its own to read.
   * @param handle - The transient about to be sampled.
   * @param session - The frame's render session.
   * @param out - Four-element destination for the rect.
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
   * Drop the cached `RenderTarget` ref on every pass
   *
   * Called only from the swap-chain / resize reset path in `_maybeResetRenderTargetCache`, after
   * the global `_renderTargetCache` is torn down. The source-identity diff
   * in `_resolveTarget` would re-query on its own there (every source uid
   * changed), but clearing the refs explicitly stops the dropped targets
   * from being retained via `cachedTarget`.
   */
  private _invalidatePerPassTargets(): void {
    for (let i = 0; i < this._passes.length; i++) this._passes[i].cachedTarget = null;
  }

  /**
   * Materialise `session.defaultTarget`'s depth and register it in the render-target cache
   *
   * Keyed by the live colour + depth sources so default-attachment passes resolve to pixi's own
   * target rather than a parallel `RenderTarget` wrapping the same textures. Ensure the
   * depth-stencil *before* seeding the key so it matches what `_resolveTarget` builds.
   * `activeTarget` is left null — the first default-target pass establishes the binding in
   * `execute`.
   * @param session - The frame's render session, which owns the default target
   */
  private _prepareDefaultTarget(session: RenderSession): void {
    session.defaultTarget.ensureDepthStencilTexture();

    this._defaultCacheKey.colors![0].texture = session.defaultTarget.colorTexture.source;
    this._defaultCacheKey.depth!.texture = session.defaultTarget.depthStencilTexture!.source;
    this._renderTargetCache.addToCache(this._defaultCacheKey, session.defaultTarget);
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
   * Rules in priority order:
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
   * @param session - The frame's render session, whose default attachments are compared with last frame's
   */
  private _maybeResetRenderTargetCache(session: RenderSession): void {
    const colorTex = session.defaultTarget.colorTexture.source;
    const depthTex = session.defaultTarget.depthStencilTexture?.source;
    const colorUid = colorTex.uid;
    const depthUid = depthTex ? depthTex.uid : -1;
    // `-1` is the "never observed yet" sentinel. This runs *before*
    // `_prepareDefaultTarget` materialises the default depth, so frame 1
    // sees `depthUid === -1`. Gating on `_last* !== -1` prevents that
    // lazy-init transition from looking like a swap-chain change.
    const colorChanged = this._lastColorUid !== -1 && colorUid !== this._lastColorUid;
    const depthChanged = this._lastDepthUid !== -1 && depthUid !== this._lastDepthUid;
    if (colorChanged || depthChanged) {
      this._renderTargetCache.reset();
      // The source-identity diff would catch this too (every source uid
      // changed), but invalidating explicitly keeps the dropped global-cache
      // entries from being held onto by `cachedTarget` refs.
      this._invalidatePerPassTargets();
    }
    this._lastColorUid = colorUid;
    this._lastDepthUid = depthUid;
  }

  /**
   * Repair any transient sample slot whose texture the pool has destroyed
   *
   * A pass that did not run this frame still owns slots in the view's global bind group, and the
   * pool may prune the idle texture they point at (a canvas resize drops the buckets the old size
   * was keeping). Pixi nulls such a slot; a depth view reports its source as destroyed. Either
   * way the slot goes back to the placeholder it was built with, and on WebGPU the view's
   * bundles re-record, since they baked the bind group that held the dead texture. Runs at
   * execute start, before any bind; the steady state touches nothing.
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
        // Depth slots bind a `TextureView` (WebGPU `texture_depth_2d`); colour slots a raw source.
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
