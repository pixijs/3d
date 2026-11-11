import { CLEAR, Rectangle, RendererType, Texture, TexturePool, TextureView } from 'pixi.js';
import type {
  BindResource,
  BindableTexture,
  BindOptions,
  PointData,
  RenderTarget,
  RgbaArray,
  TEXTURE_FORMATS,
  WebGLRenderer,
  WebGPURenderer,
  TextureSource,
} from 'pixi.js';

import type { Camera3D } from '../../scene/cameras/Camera3D';
import { getCameraData } from '../CameraData';
import { prepareCamera, uploadCamera } from '../prepareCamera';
import type { RenderSession } from '../render-passes/RenderSession';
import { isLinearFormat } from '../shader/bits/decodeToLinearBit';
import { DEPTH_VIEW_PLACEHOLDER } from '../textures/DefaultTextures';
import type { View3DPipe } from '../View3DPipe';
import { assertColorAttachmentLimits } from './assertColorAttachmentLimits';
import type { ColorAttachmentFormat } from './assertColorAttachmentLimits';
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
import { assertSceneOutput, sameSceneOutput } from './SceneOutput';
import type { SceneOutput } from './SceneOutput';
import type { GlobalTextureBindings } from './TextureBinding';

const DEPTH_FORMAT = 'depth24plus-stencil8';

interface ResolvedTarget {
  target: RenderTarget | null;
  flipY: boolean;
  frame: Rectangle | null;
}

/** @internal */
export interface DrawTarget {
  target: RenderTarget;
  /** Content rect in physical pixels */
  readonly viewport: Rectangle;
  /** Source `target` was looked up under; `null` once it's back in the pool, and `target` leaves it out */
  colorSource: TextureSource | null;
  /** As `colorSource`, for the depth */
  depthSource: TextureSource | null;
}

const _activeViewport = new Rectangle();
interface SceneOutputEntry {
  output: SceneOutput;
  color: ColorHandle;
}

const _resolvedTarget: ResolvedTarget = { target: null, flipY: false, frame: null };
/** `_drawTarget` puts `Texture.EMPTY` back after each lookup, so this module-level key never holds a source alive */
const _drawTargetKey: PassAttachments = {};
const _drawTargetColors = [{ texture: Texture.EMPTY.source }];
const _drawTargetDepth = { texture: Texture.EMPTY.source };
/** `_resolveDepth` nulls `target` after each copy, so this module-level scratch never holds a target alive */
const _depthResolveSource: DrawTarget = {
  target: null!,
  viewport: new Rectangle(),
  colorSource: null,
  depthSource: null,
};

function toPhysicalRect(frame: Rectangle, resolution: number, out: Rectangle): Rectangle {
  out.x = Math.round(frame.x * resolution);
  out.y = Math.round(frame.y * resolution);
  out.width = Math.max(1, Math.round(frame.width * resolution));
  out.height = Math.max(1, Math.round(frame.height * resolution));
  return out;
}

/**
 * The passes draw into `color`, never `texture`, so a mesh sampling the texture reads last frame's picture,
 * as Camera3D promises
 */
interface CameraTarget {
  color: ColorHandle;
  depth: DepthHandle;
  texture: ColorHandle;
  draw: DrawTarget | null;
}

/**
 * `cachedTexture` and `cachedDepthView` are destroyed, not dropped, when their source changes, since each listens
 * on a source that outlives it; a transient keeps its depth view across frames, so the steady state allocates nothing
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
      /** `null` outside the passes that use it this frame */
      texture: Texture | null;
      cachedTexture: Texture | null;
      cachedDepthView: TextureView | null;
      cachedDepthViewSource: TextureSource | null;
    };

interface AddedPass {
  pass: GraphRenderPass;
  record: PassRecord;
  /** A reader gets every earlier writer, not just the last, since the last one's `condition` can skip it */
  dependsOn: AddedPass[];
  isAnchored: boolean;
  /** Cameras copied into their textures before `finishedColors` are processed, since those can include the textures */
  copyCameras: Camera3D[];
  /** Resolved, then mipmapped, in that order, so the mips come from the resolved picture */
  finishedColors: ColorHandle[];
  /** Resolved from the target this pass drew into, once per run of writers before a sampler */
  depthResolves: DepthHandle[];
  /** Also set on a colour's last writer; `execute()`'s `colorResolved` keeps it to one resolve beside `finishedColors` */
  resolvesColor: boolean;
  /** Built once by `compile()` and patched each frame, so the lookup allocates nothing; `null` with no attachments */
  attachments: PassAttachments | null;
  /** Parallel to `attachments.colors` */
  colorHandles: ColorHandle[];
  depthHandle: DepthHandle | null;
  sampleAccesses: ResourceAccess[];
  /** Source uid last bound per sample access, `-1` before the first; a change re-records the WebGPU bundles */
  lastSampleSourceUids: number[];
  cachedTarget: RenderTarget | null;
  /**
   * Equals `_resolveTick` once the pass passes its `condition` this frame, as `neededTick` does once it
   * survives the cull; ticks in place of Sets, so the cull allocates nothing
   */
  candidateTick: number;
  neededTick: number;
}

/**
 * Options for a {@link RenderGraph}
 * @category rendering
 * @advanced
 */
export interface RenderGraphOptions {
  /** The view's global texture bindings: pass on {@link DefaultGraph3DOptions#globalTextureBindings} */
  globalTextureBindings: GlobalTextureBindings;
  /** Returns, each frame, the colour of the target the view draws into: usually `session.defaultTarget.colorTexture` */
  defaultColor: (session: RenderSession) => BindableTexture;
  /**
   * Returns, each frame, the depth of the target the view draws into: usually
   * `session.defaultTarget.depthStencilTexture!`
   */
  defaultDepth: (session: RenderSession) => BindableTexture;
  /**
   * A texture for the scene to draw into, sized at {@link RenderGraph#resolution}
   *
   * A pass must then draw it onto {@link RenderGraph#defaultColor}, as an {@link OutputPass} does.
   * Leave it and `sceneDepth` out to draw the scene straight into the view's target.
   */
  sceneColor?: Omit<TransientTextureOptions, 'resolution'>;
  /** Depth for {@link RenderGraphOptions#sceneColor}; give both or neither, with the same size and `antialias` */
  sceneDepth?: Omit<TransientTextureOptions, 'resolution'>;
  /**
   * Scene outputs the scene passes write beside the scene colour, at its size; passes reach them
   * with {@link RenderGraph#getSceneOutput}. Needs `sceneColor`, or the constructor throws. With a
   * multisampled scene colour, each output's format must be one the GPU can average: not an integer
   * format, a 32-bit float one, or `rgba8unorm` on WebGL. Fixed for the graph's lifetime.
   */
  sceneOutputs?: readonly SceneOutput[];
}

/**
 * The ordered passes a {@link View3D} renders, and the textures they read and write
 *
 * Each pass declares in `setup` what it reads and writes. From that the graph lends the passes
 * pooled textures for as long as they're used, binds each pass's target, and each frame skips any
 * pass whose output nothing uses. A view builds one with {@link createDefaultGraph3D}, or with its
 * `graph` option, then compiles and runs it.
 * @category rendering
 * @advanced
 */
export class RenderGraph {
  private readonly _resources: ResourceEntry[] = [];
  private readonly _passes: AddedPass[] = [];

  private readonly _builder: PassBuilder;

  private readonly _renderTargetCache: RenderTargetCache = new RenderTargetCache();

  private readonly _defaultCacheKey: PassAttachments = {
    colors: [{ texture: Texture.EMPTY.source }],
    depth: { texture: Texture.EMPTY.source },
  };

  /** Shares `_defaultCacheKey`'s attachment objects, so patching that key's sources patches this one too */
  private readonly _defaultCacheKeyReadOnlyDepth: PassAttachments = {
    colors: this._defaultCacheKey.colors,
    depth: this._defaultCacheKey.depth,
    depthReadOnly: true,
  };

  private readonly _cameraTargets = new Map<Camera3D, CameraTarget>();

  private _sceneDrawTarget: DrawTarget | null = null;

  private readonly _camerasSeen = new Set<Camera3D>();

  /**
   * Camera target colours, whose writers are anchored like an imported texture's, and which bind with
   * the outer `flipY` so the copy lands upright
   */
  private readonly _cameraTargetColors = new Set<number>();

  /**
   * The colour the scene draws into: the texture made from {@link RenderGraphOptions#sceneColor}, or
   * {@link RenderGraph#defaultColor} without one
   */
  public readonly sceneColor: ColorHandle;

  /**
   * Whether {@link RenderGraph#sceneColor} holds linear light, from a float or `-srgb` format in
   * {@link RenderGraphOptions#sceneColor}
   *
   * If so, the view leaves the tone curve out of its materials and sky, and a pass in the graph must
   * apply it, as an {@link OutputPass} does; see {@link View3D#toneMapping}.
   */
  public get sceneIsLinear(): boolean {
    const format = this._sceneColorOptions?.format;
    return format !== undefined && isLinearFormat(format);
  }

  /** Depth paired with {@link RenderGraph#sceneColor} */
  public readonly sceneDepth: DepthHandle;
  /** The scene outputs this graph attaches, as given in {@link RenderGraphOptions#sceneOutputs} */
  public readonly sceneOutputs: readonly SceneOutput[];
  /**
   * Texels per logical pixel of the scene, which every texture with `resolution: 'inherit'` follows
   *
   * The view sets it before each frame: its target's resolution when the scene draws straight to the
   * target, otherwise {@link View3D#resolution}.
   */
  public resolution = 1;
  private readonly _sceneOutputsByName = new Map<string, SceneOutputEntry>();
  private readonly _clearValueById: Record<number, RgbaArray> = Object.create(null);
  /** `null` when the scene draws straight into the view's target */
  private readonly _sceneColorOptions: Omit<TransientTextureOptions, 'resolution'> | null;
  /** The colour of the target the view draws into, such as the canvas: where the final picture goes */
  public readonly defaultColor: ColorHandle;
  /** Depth paired with {@link RenderGraph#defaultColor} */
  public readonly defaultDepth: DepthHandle;

  private _lastColorUid = -1;
  private _lastDepthUid = -1;
  /** The default colour's size last frame, in physical pixels */
  private _lastWidth = -1;
  private _lastHeight = -1;

  private readonly _activePasses: AddedPass[] = [];

  private readonly _acquireAt: number[][] = [];
  private readonly _releaseAt: number[][] = [];

  /** Active-pass index by resource id, `-1` when unused this frame; refilled in place, so nothing is allocated */
  private _firstUseByResId: Int32Array = new Int32Array(0);
  private _lastUseByResId: Int32Array = new Int32Array(0);
  private _firstWriterByResId: Int32Array = new Int32Array(0);
  private _lastWriterByResId: Int32Array = new Int32Array(0);
  private readonly _lastWrittenHandleByResId: (ColorHandle | undefined)[] = [];

  /** The single-sample copy each sampled transient depth resolves into, by `handle._id`; used only while it's multisampled */
  private readonly _depthResolveByResId: (DepthHandle | undefined)[] = [];
  /** The pass a multisampled depth last resolved after, by `handle._id`, or `-1`; written again after a sampler, it resolves again */
  private _depthResolvedAtByResId: Int32Array = new Int32Array(0);

  private _resolveTick = 0;
  private _limitsChecked = false;

  private readonly _resolveCandidates: AddedPass[] = [];
  private readonly _resolveStack: AddedPass[] = [];

  /** The binding live when `execute` starts, bound again at its end so later 2D content lands where it would have */
  private _savedBind?: BindOptions;

  /** Refilled per bind, since pixi copies it; `execute` clears its target and frame before returning */
  private readonly _bindOptions: BindOptions = { target: null!, clear: CLEAR.NONE, frame: undefined, flipY: false };

  private _destroyed = false;

  /** The view's global texture bindings; passes reach them through {@link PassBuilder#globalTextureBindings} */
  public readonly globalTextureBindings: GlobalTextureBindings;

  constructor(opts: RenderGraphOptions) {
    this.globalTextureBindings = opts.globalTextureBindings;
    this.defaultColor = this.importColor(opts.defaultColor);
    this.defaultDepth = this.importDepth(opts.defaultDepth);
    const sceneColor = opts.sceneColor;
    this.sceneColor = sceneColor ? this.createColor(sceneColor) : this.defaultColor;
    this.sceneDepth = opts.sceneDepth ? this.createDepth(opts.sceneDepth) : this.defaultDepth;
    this._sceneColorOptions = sceneColor ?? null;

    this.sceneOutputs = opts.sceneOutputs ?? [];
    if (this.sceneOutputs.length > 0) {
      if (!sceneColor) {
        throw new Error(
          'RenderGraph: sceneOutputs need a sceneColor. The scene passes attach each output beside the scene ' +
            "colour, and the screen can't hold extra attachments, so give the graph a `sceneColor` and " +
            '`sceneDepth`, as createDefaultGraph3D does whenever a pass requires an output.',
        );
      }
      for (const output of this.sceneOutputs) {
        assertSceneOutput(output);
        const color = this.createColor({
          width: sceneColor.width,
          height: sceneColor.height,
          antialias: sceneColor.antialias,
          format: output.format,
          scaleMode: output.format.includes('int') ? 'nearest' : undefined,
          label: output.name,
        });
        this._sceneOutputsByName.set(output.name, { output, color });
        if (output.clearValue) this._clearValueById[color._id] = output.clearValue;
      }
    }

    this._builder = new PassBuilder(this);
  }

  /**
   * The texture of a scene output this graph attaches, for a pass to read or draw into
   *
   * Declare the access in the pass's `setup`, as for any graph texture. A `'beforeOpaque'` pass runs
   * before the scene writes it, and an `'afterOpaque'` pass runs before transparent and glass
   * surfaces do.
   * @example
   * ```ts
   * const normals = graph.getSceneOutput(normalOutput);
   * ```
   * @param output - An output in {@link RenderGraph#sceneOutputs}, which a pass's
   *   {@link Pass3D#requiredOutputs} puts there.
   * @returns The output's texture handle.
   * @throws If the graph doesn't attach an output with this name.
   */
  public getSceneOutput(output: SceneOutput): ColorHandle {
    const entry = this._sceneOutputsByName.get(output.name);
    if (!entry) {
      throw new Error(
        `RenderGraph.getSceneOutput: this graph doesn't attach '${output.name}'. List it in the ` +
          "pass's `requiredOutputs`, so the view attaches it. A custom graph builder forwards `options.passes` " +
          "to createDefaultGraph3D, or gives the output to its RenderGraph's `sceneOutputs` option.",
      );
    }
    return entry.color;
  }

  /**
   * Whether this graph attaches `output`, for a pass that uses it when the view has it and works
   * without it otherwise
   *
   * It matches by name and content, so a different output that shares the name doesn't count.
   * @example
   * ```ts
   * const normals = graph.hasSceneOutput(normalOutput) ? graph.getSceneOutput(normalOutput) : null;
   * ```
   * @param output - The output to look for.
   * @returns Whether the graph attaches this output, by name and content.
   */
  public hasSceneOutput(output: SceneOutput): boolean {
    const entry = this._sceneOutputsByName.get(output.name);
    return entry !== undefined && sameSceneOutput(entry.output, output);
  }

  /**
   * Adds a colour texture you own, such as a render texture, for passes to draw into
   *
   * `getter` runs each frame, so the graph follows a resized or swapped texture. A pass that writes
   * it runs even when no pass reads it, and the graph never clears it.
   * @param getter - Resolves the live texture for the frame.
   * @returns The handle for the imported colour resource.
   */
  public importColor(getter: (s: RenderSession) => BindableTexture): ColorHandle {
    return this._importResource('color', getter) as ColorHandle;
  }

  /**
   * Adds a depth texture you own; see {@link RenderGraph#importColor}
   * @param getter - Resolves the live texture for the frame.
   * @returns The handle for the imported depth resource.
   */
  public importDepth(getter: (s: RenderSession) => BindableTexture): DepthHandle {
    return this._importResource('depth', getter) as DepthHandle;
  }

  /**
   * Creates a colour texture the graph allocates; {@link TransientTextureOptions} sets its size and format
   *
   * The graph takes it from pixi's `TexturePool` before the first pass that uses it each frame and
   * gives it back after the last, so don't count on its content in the next frame.
   * @param options - Size, resolution, format and label; see {@link TransientTextureOptions}.
   * @returns The handle for the transient colour resource.
   */
  public createColor(options: TransientTextureOptions = {}): ColorHandle {
    const format = options.format ?? this._sceneColorOptions?.format;
    return this._createTransient('color', this._describe('color', { ...options, format })) as ColorHandle;
  }

  /**
   * Creates a depth texture the graph allocates; see {@link RenderGraph#createColor}
   * @param options - Size, resolution, format and label; see {@link TransientTextureOptions}.
   * @returns The handle for the transient depth resource.
   */
  public createDepth(options: TransientTextureOptions = {}): DepthHandle {
    return this._createTransient('depth', this._describe('depth', options)) as DepthHandle;
  }

  /** @internal */
  public _cameraTarget(camera: Camera3D): CameraTarget {
    if (!camera.renderTexture) {
      throw new Error('RenderGraph._cameraTarget: this camera has no renderTexture.');
    }

    let target = this._cameraTargets.get(camera);

    if (target) return target;

    const colorDescriptor: ResourceDescriptor = {
      width: 0,
      height: 0,
      format: this._cameraTargetFormat(camera),
      label: 'cameraTarget',
    };
    const depthDescriptor: ResourceDescriptor = {
      width: 0,
      height: 0,
      format: DEPTH_FORMAT,
      label: 'cameraTargetDepth',
    };
    const describeTextureSize = (out: ResourceDescriptor): ResourceDescriptor => {
      const { frame, source } = camera.renderTexture!;
      out.width = Math.max(1, Math.round(frame.width * source.resolution));
      out.height = Math.max(1, Math.round(frame.height * source.resolution));
      return out;
    };

    target = {
      color: this._createTransient('color', () => {
        colorDescriptor.format = this._cameraTargetFormat(camera);
        colorDescriptor.antialias = camera.renderTexture!.source.antialias;
        return describeTextureSize(colorDescriptor);
      }) as ColorHandle,
      depth: this._createTransient('depth', () => {
        depthDescriptor.antialias = camera.renderTexture!.source.antialias;
        return describeTextureSize(depthDescriptor);
      }) as DepthHandle,
      texture: this._importResource('color', () => camera.renderTexture!) as ColorHandle,
      draw: null,
    };
    this._cameraTargetColors.add(target.color._id);

    this._cameraTargets.set(camera, target);

    return target;
  }

  /** The scene's format in a linear scene, since `CopyOpaquePass` copies the camera's target into a scene-format one */
  private _cameraTargetFormat(camera: Camera3D): TEXTURE_FORMATS {
    return this.sceneIsLinear ? this._sceneColorOptions!.format! : camera.renderTexture!.source.format;
  }

  /**
   * From the render-target cache, so over the screen it's pixi's own target, not a second one over
   * the same textures; the rect is refreshed every call, since a pooled source can return with another content size
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

  /** The passes in the order they run, in a new array each call */
  public get passes(): GraphRenderPass[] {
    const out: GraphRenderPass[] = [];
    for (let i = 0; i < this._passes.length; i++) out.push(this._passes[i].pass);
    return out;
  }

  /**
   * Writes the scale from view UVs, 0 to 1, to the content of a scene-sized graph texture, which the
   * pool can make larger than its content
   * @param pixelWidth - Scene width in texels, from {@link RenderGraph#sceneViewport}.
   * @param pixelHeight - Scene height in texels.
   * @param out - Destination for the scale.
   */
  public setViewportUvScale(pixelWidth: number, pixelHeight: number, out: PointData): void {
    const size = TexturePool.getOptimalSize(pixelWidth, pixelHeight);
    out.x = pixelWidth / size.width;
    out.y = pixelHeight / size.height;
  }

  /**
   * The scene's content rect in its own texels, available before any target is bound
   *
   * When the scene draws straight into the view's target, it's the view's place there. Otherwise it
   * starts at the origin of the scene texture and is sized at {@link RenderGraph#resolution}.
   * @param session - The frame's render session, with `viewport` filled.
   * @param out - Receives the rect.
   * @returns `out`, for inline use.
   */
  public sceneViewport(session: RenderSession, out: Rectangle): Rectangle {
    const options = this._sceneColorOptions;

    if (!options) return out.copyFrom(session.viewport);

    out.x = 0;
    out.y = 0;
    return this._contentSize(options, this.resolution, session, out);
  }

  private _contentSize<T extends Pick<Rectangle, 'width' | 'height'>>(
    options: TransientTextureOptions,
    resolution: number,
    s: RenderSession,
    out: T,
  ): T {
    const targetResolution = s.defaultTarget.colorTexture.source.resolution;
    const width = options.width ?? s.viewport.width / targetResolution;
    const height = options.height ?? s.viewport.height / targetResolution;
    out.width = Math.max(1, Math.round(width * resolution));
    out.height = Math.max(1, Math.round(height * resolution));
    return out;
  }

  /** The returned function refills one descriptor per call, which is safe because the pool only reads it */
  private _describe(type: ResourceKind, options: TransientTextureOptions): (s: RenderSession) => ResourceDescriptor {
    const depth = type === 'depth';
    const scaleMode = options.scaleMode ?? (depth ? 'nearest' : undefined);
    const descriptor: ResourceDescriptor = {
      width: 0,
      height: 0,
      format: DEPTH_FORMAT,
      autoGenerateMipmaps: options.autoGenerateMipmaps ?? false,
      label: options.label ?? (depth ? 'depthTransient' : 'colorTransient'),
    };
    if (scaleMode) descriptor.scaleMode = scaleMode;
    if (options.antialias) descriptor.antialias = true;
    return (s: RenderSession) => {
      const resolution = typeof options.resolution === 'number' ? options.resolution : this.resolution;
      this._contentSize(options, resolution, s, descriptor);
      descriptor.format =
        options.format ?? (depth ? DEPTH_FORMAT : (s.defaultTarget.colorTexture.source.format ?? 'bgra8unorm'));
      return descriptor;
    };
  }

  /**
   * Adds a pass after those already added, and runs its `setup` now
   *
   * Passes run in the order they're added. Keep the handles `setup` declares for `render`.
   * @param pass - The pass to register.
   * @returns The same pass, for inline capture.
   */
  public addPass<T extends GraphRenderPass>(pass: T): T {
    const record: PassRecord = { accesses: [], hasSideEffect: false };
    this._passes.push({
      pass,
      record,
      dependsOn: [],
      isAnchored: false,
      attachments: null,
      colorHandles: [],
      depthHandle: null,
      sampleAccesses: [],
      lastSampleSourceUids: [],
      cachedTarget: null,
      candidateTick: 0,
      neededTick: 0,
      copyCameras: [],
      finishedColors: [],
      depthResolves: [],
      resolvesColor: false,
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
   * Works out what each pass depends on and which target it binds; the view calls it once the graph
   * is built
   *
   * It can run again, and starts afresh each time. It throws when a pass both writes and reads one
   * texture, or samples, through a global binding, a texture {@link PassBuilder#sample} says needs
   * the pass's own bind group.
   */
  public compile(): void {
    this._limitsChecked = false;
    for (let i = 0; i < this._passes.length; i++) {
      const ap = this._passes[i];
      ap.dependsOn.length = 0;
      ap.isAnchored = ap.record.hasSideEffect;
      ap.attachments = null;
      ap.colorHandles.length = 0;
      ap.depthHandle = null;
      ap.sampleAccesses.length = 0;
      ap.lastSampleSourceUids.length = 0;
      ap.cachedTarget = null;
    }

    const writersById: Record<number, AddedPass[]> = Object.create(null);
    const attachedBy: Record<number, AddedPass> = Object.create(null);

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
            ap.sampleAccesses.push(a);
            ap.lastSampleSourceUids.push(-1);
            if (a.handle._kind === 'depth' && this._resources[id].kind === 'transient') {
              this._ensureDepthResolve(a.handle as DepthHandle);
            }
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
        } else {
          continue;
        }
        if (this._resources[id].kind === 'transient') attachedBy[id] ??= ap;
      }

      if (!hasAttachment) continue;

      const attachments: PassAttachments = {};
      if (ap.colorHandles.length > 0) {
        const colors: {
          /** Patched to the live source each frame */
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

    const globalGroup = this.globalTextureBindings.opaqueDepth.group;
    for (let i = 0; i < this._passes.length; i++) {
      const ap = this._passes[i];
      for (let j = 0; j < ap.sampleAccesses.length; j++) {
        const a = ap.sampleAccesses[j];
        const attacher = attachedBy[a.handle._id];
        if (a.binding!.group === globalGroup && attacher) {
          throw new Error(
            `RenderGraph.compile: pass "${ap.pass.name}" samples resource ${a.handle._id} through the view's global ` +
              `bind group, and pass "${attacher.pass.name}" attaches it. The global group stays bound while every pass ` +
              'draws, so a texture it holds cannot also be a render target. Sample it through a bind group the pass owns.',
          );
        }
      }
    }
  }

  /** @internal */
  public run(session: RenderSession): void {
    this.resolve(session);
    this.prepareCameras(session);
    this.execute(session);
  }

  /**
   * Places a camera's copy after the last pass that writes its colour, the last point the colour is still allocated
   * @internal
   */
  public resolve(session: RenderSession): void {
    this._activePasses.length = 0;
    if (!this._limitsChecked) this._assertAttachmentLimits(session);

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
      this._activePasses[i].finishedColors.length = 0;
      this._activePasses[i].depthResolves.length = 0;
      this._activePasses[i].resolvesColor = false;
    }

    const resCount = this._resources.length;
    if (this._firstUseByResId.length < resCount) {
      this._firstUseByResId = new Int32Array(resCount);
      this._lastUseByResId = new Int32Array(resCount);
      this._firstWriterByResId = new Int32Array(resCount);
      this._lastWriterByResId = new Int32Array(resCount);
      this._lastWrittenHandleByResId.length = resCount;
      this._depthResolvedAtByResId = new Int32Array(resCount);
    }
    const firstUse = this._firstUseByResId;
    const lastUse = this._lastUseByResId;
    const firstWriter = this._firstWriterByResId;
    const lastWriter = this._lastWriterByResId;
    const lastWrittenHandle = this._lastWrittenHandleByResId;
    const resolvedAt = this._depthResolvedAtByResId;
    firstUse.fill(-1, 0, resCount);
    lastUse.fill(-1, 0, resCount);
    firstWriter.fill(-1, 0, resCount);
    lastWriter.fill(-1, 0, resCount);
    resolvedAt.fill(-1, 0, resCount);

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
          lastWriter[id] = i;
          if (entry.type === 'color') lastWrittenHandle[id] = a.handle as ColorHandle;
        } else if (
          a.mode === 'sample' &&
          a.handle._kind === 'depth' &&
          entry.kind === 'transient' &&
          lastWriter[id] !== -1 &&
          entry.describe(session).antialias
        ) {
          const at = lastWriter[id];
          const copyId = this._depthResolveByResId[id]!._id;
          if (resolvedAt[id] !== at) {
            resolvedAt[id] = at;
            this._activePasses[at].depthResolves.push(a.handle as DepthHandle);
            if (firstUse[copyId] === -1) firstUse[copyId] = at;
          }
          lastUse[copyId] = i;
        } else if (
          a.mode === 'sample' &&
          a.handle._kind === 'color' &&
          entry.kind === 'transient' &&
          lastWriter[id] !== -1 &&
          !this._activePasses[lastWriter[id]].resolvesColor &&
          entry.describe(session).antialias
        ) {
          this._activePasses[lastWriter[id]].resolvesColor = true;
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
      if (last !== -1 && this._resources[id].type === 'color') {
        this._activePasses[last].finishedColors.push(lastWrittenHandle[id]!);
      }
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
      ap.finishedColors.push(cameraTarget.texture);
    }
  }

  /**
   * Runs after the view packs its lights, which `uploadCamera` bins, and before any target is bound, so every
   * camera reads its front-face winding off the same binding
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
   * Never clears the view's own target, which holds the 2D content beneath, and a clear would stop views sharing
   * pixi's open WebGPU pass; a transient binds with the `flipY` that matches the outer target's winding
   * @internal
   */
  public execute(session: RenderSession): void {
    this._maybeResetRenderTargetCache(session);
    this._prepareDefaultTarget(session);
    const renderer = session.renderer as WebGLRenderer | WebGPURenderer;
    const pipe = renderer.renderPipes.view3d;

    const savedBind = (this._savedBind = renderer.renderTarget.getBindState(this._savedBind));
    const defaultSurface = savedBind.target;
    const defaultFlipY = !!savedBind.flipY;
    const bindOptions = this._bindOptions;

    const outerInverted = renderer.renderTarget.isFrontFaceInverted(session.defaultTarget, defaultFlipY);
    const transientFlipY = outerInverted !== (renderer.type === RendererType.WEBGL);
    session.defaultFrontFaceInverted = outerInverted;

    for (let i = 0; i < this._activePasses.length; i++) {
      this._activePasses[i].pass.prepare?.(session);
    }

    for (let i = 0; i < this._activePasses.length; i++) {
      const ap = this._activePasses[i];
      const { pass } = ap;

      const toAcquire = this._acquireAt[i];
      for (let k = 0; k < toAcquire.length; k++) {
        const entry = this._resources[toAcquire[k]] as Extract<ResourceEntry, { kind: 'transient' }>;
        const desc = entry.describe(session);
        const texture = TexturePool.getOptimalTexture(desc);
        if (desc.label) texture.source.label = desc.label;
        entry.texture = texture;
      }

      const { target, flipY, frame } = this._resolveTarget(ap, i, session, transientFlipY, defaultFlipY);

      if (target === session.defaultTarget) {
        if (session.activeTarget !== target) {
          bindOptions.target = defaultSurface;
          bindOptions.clear = CLEAR.NONE;
          bindOptions.frame = getCameraData(session.view3d.camera).frame;
          bindOptions.flipY = defaultFlipY;
          renderer.renderTarget.bind(bindOptions);
          session.activeTarget = target;
          session.activeViewport = session.viewport;
        }
      } else if (target !== null && target !== session.activeTarget) {
        const clear = this._resolveClear(ap, i);
        bindOptions.target = target;
        bindOptions.clear = clear;
        bindOptions.frame = frame ?? undefined;
        bindOptions.flipY = flipY;
        renderer.renderTarget.bind(bindOptions);
        if ((clear & CLEAR.DEPTH) !== 0 && ap.depthHandle !== null && ap.depthHandle._id === this.sceneDepth._id) {
          session.needsDepthClear = false;
        }
        session.activeTarget = target;
        if (frame) {
          const resolution = (target.colorTexture?.source ?? target.depthStencilTexture!.source).resolution;
          session.activeViewport = toPhysicalRect(frame, resolution, _activeViewport);
        }
      }

      const sampleAccesses = ap.sampleAccesses;
      const lastSampleSourceUids = ap.lastSampleSourceUids;
      for (let j = 0; j < sampleAccesses.length; j++) {
        const a = sampleAccesses[j];
        const binding = a.binding!;
        let handle = a.handle;
        if (handle._kind === 'depth' && this._depthResolvedAtByResId[handle._id] !== -1) {
          handle = this._depthResolveByResId[handle._id]!;
        }
        const resolved = this._bindResource(handle, session);
        binding.group.setResource(resolved, binding.slot);
        if (binding.styleSlot !== undefined)
          binding.group.setResource((resolved as TextureSource).style, binding.styleSlot);
        const r = resolved as {
          source?: {
            uid?: number;
          };
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
      const passViewport =
        passCamera && cameraFrameToPhysicalViewport(passCamera, session, session.activeViewport, this.resolution);

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

      const depthResolves = ap.depthResolves;
      for (let k = 0; k < depthResolves.length; k++) {
        this._resolveDepth(ap, depthResolves[k], target, pipe, session);
      }

      let colorResolved = depthResolves.length > 0;
      if (!colorResolved && ap.resolvesColor) {
        pipe.resolveColor();
        colorResolved = true;
      }
      const copyCameras = ap.copyCameras;
      for (let k = 0; k < copyCameras.length; k++) {
        const camera = copyCameras[k];
        const renderTexture = camera.renderTexture!;
        const drawTarget = this._drawTarget(camera, session);
        const format = renderTexture.source.format;
        if (this._cameraTargetFormat(camera) === format) {
          pipe.copyColor(drawTarget, renderTexture, session);
        } else {
          if (!colorResolved && drawTarget.target.colorTexture.source.antialias) {
            pipe.resolveColor();
            colorResolved = true;
          }
          pipe.outputColor(
            drawTarget,
            renderTexture,
            session,
            isLinearFormat(format) ? null : session.view3d.toneMapping,
          );
        }
      }

      const finishedColors = ap.finishedColors;
      for (let k = 0; k < finishedColors.length; k++) {
        const handle = finishedColors[k];
        const source = this.getTexture(handle, session).source;
        if (
          !colorResolved &&
          source.antialias &&
          this._resources[handle._id].kind === 'transient' &&
          !this._cameraTargetColors.has(handle._id)
        ) {
          pipe.resolveColor();
          colorResolved = true;
        }
        if (source.autoGenerateMipmaps) pipe.generateMips(handle, session);
      }

      const toRelease = this._releaseAt[i];
      for (let k = 0; k < toRelease.length; k++) {
        const entry = this._resources[toRelease[k]] as Extract<ResourceEntry, { kind: 'transient' }>;
        TexturePool.returnTexture(entry.texture!);
        entry.texture = null;
      }
    }

    renderer.renderTarget.bind(savedBind);
    session.activeTarget = null;
    bindOptions.target = null!;
    bindOptions.frame = undefined;
  }

  /**
   * Frees the GPU memory each pass can rebuild, such as the shadow map, through its
   * {@link GraphRenderPass#unload}; the graph keeps rendering
   *
   * Textures the graph allocates are back in pixi's `TexturePool` between frames, and stay there.
   */
  public unload(): void {
    if (this._destroyed) return;

    for (let i = 0; i < this._passes.length; i++) {
      this._passes[i].pass.unload?.();
    }
  }

  /**
   * Destroys the graph and its passes; imported textures are left alone, and pixi's `TexturePool`
   * keeps the textures the graph used
   */
  public destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._releaseTransients();

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

    (this._resources as ResourceEntry[] | null) = null;
    (this._passes as AddedPass[] | null) = null;
    (this._activePasses as AddedPass[] | null) = null;
    (this._cameraTargets as Map<Camera3D, CameraTarget> | null) = null;
    (this._cameraTargetColors as Set<number> | null) = null;
    this._sceneDrawTarget = null;
  }

  /** A depth handle binds as a depth-only view, since WebGPU's `texture_depth_2d` rejects a depth-stencil source */
  private _bindResource(handle: ResourceHandle, session: RenderSession): BindResource {
    const source = this.getTexture(handle, session).source;
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
   * The texture behind a handle, for a pass that binds it itself, such as raw WebGPU compute
   *
   * Call it in the pass's `render`, for a handle the pass declared in `setup`;
   * {@link PassBuilder#sample} binds a texture for you instead. A texture the graph allocated lives
   * from the first pass that uses it to the last, and then the pool can hand it to another pass, so
   * don't keep it past `render`. Outside that span this throws.
   *
   * On WebGPU, record on `renderer.encoder.commandEncoder`: work on an encoder of your own runs
   * before this frame's earlier passes, and reads what the texture held before this frame. A render
   * pass can still be open, so call `renderer.renderTarget.finishRenderPass()` first, and set
   * {@link RenderSession#activeTarget} to `null` so the next pass binds its target again.
   * `renderer.texture.getGpuSource(texture.source)` gives the `GPUTexture`, and
   * `renderer.texture.getTextureView` gives a view it caches on the source, so a bind group made from
   * that view can be kept while the view stays the same.
   *
   * A pooled texture can be larger than its content: `texture.frame` times
   * `texture.source.resolution` is the content rect in texels. A depth-stencil texture binds to a
   * WebGPU shader through a depth-only view, as in the example.
   * @example
   * ```ts
   * const depth = graph.getTexture(depthHandle, session);
   * const depthView = renderer.texture.getTextureView(depth, { aspect: 'depth-only' });
   *
   * renderer.renderTarget.finishRenderPass();
   * session.activeTarget = null;
   * const compute = renderer.encoder.commandEncoder.beginComputePass();
   * // bind depthView, dispatch
   * compute.end();
   * ```
   * @param handle - A resource the calling pass declared.
   * @param session - The frame's render session.
   * @returns The texture, valid until the pass's `render` returns.
   */
  public getTexture(handle: ResourceHandle, session: RenderSession): Texture {
    const entry = this._resources[handle._id];
    if (entry.kind === 'transient') {
      if (entry.texture === null) {
        throw new Error(
          `RenderGraph.getTexture: '${entry.describe(session).label}' isn't alive here. A graph ` +
            'texture only exists inside the render of a pass that declared it, with b.read, b.sample ' +
            'or a write, so resolve it there and use it before render returns.',
        );
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

  /** Runs before the frame takes any pooled texture, so a view over the limit throws holding nothing */
  private _assertAttachmentLimits(session: RenderSession): void {
    const renderer = session.renderer as WebGLRenderer | WebGPURenderer;
    for (let i = 0; i < this._passes.length; i++) {
      const ap = this._passes[i];
      if (ap.colorHandles.length < 2) continue;
      const colors: ColorAttachmentFormat[] = [];
      for (let j = 0; j < ap.colorHandles.length; j++) {
        const entry = this._resources[ap.colorHandles[j]._id];
        colors.push(entry.kind === 'transient' ? entry.describe(session) : entry.getter(session).source);
      }
      assertColorAttachmentLimits(ap.pass.name, colors, renderer);
    }
    this._limitsChecked = true;
  }

  private _attachmentSource(entry: ResourceEntry, session: RenderSession): TextureSource {
    if (entry.kind === 'imported') return entry.getter(session).source;
    if (entry.texture === null) {
      throw new Error('RenderGraph._resolveTarget: a transient attachment has not been allocated');
    }
    return entry.texture.source;
  }

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

  /** The copy has a descriptor of its own, refreshed from the depth's each frame, since the depth's is multisampled */
  private _ensureDepthResolve(handle: DepthHandle): void {
    const id = handle._id;
    if (this._depthResolveByResId[id]) return;
    const entry = this._resources[id] as Extract<ResourceEntry, { /** @internal */ kind: 'transient' }>;
    const descriptor: ResourceDescriptor = { width: 0, height: 0, format: DEPTH_FORMAT, scaleMode: 'nearest' };
    this._depthResolveByResId[id] = this._createTransient('depth', (s: RenderSession) => {
      const from = entry.describe(s);
      descriptor.width = from.width;
      descriptor.height = from.height;
      descriptor.format = from.format;
      descriptor.label ??= `${from.label ?? 'depthTransient'}Resolve`;
      return descriptor;
    }) as DepthHandle;
  }

  /** The copy ends the pass's render pass, which resolves the target's colour too; `execute`'s `colorResolved` counts on it */
  private _resolveDepth(
    ap: AddedPass,
    handle: DepthHandle,
    target: RenderTarget | null,
    pipe: View3DPipe,
    session: RenderSession,
  ): void {
    if (target === null || ap.depthHandle === null || ap.depthHandle._id !== handle._id) {
      throw new Error(
        `RenderGraph: pass "${ap.pass.name}" is the last writer of a multisampled depth before a pass samples it, ` +
          "but doesn't attach it; a multisampled depth is resolved from the target that drew it.",
      );
    }
    const { frame, source } = this.getTexture(handle, session);
    const copy = this.getTexture(this._depthResolveByResId[handle._id]!, session);
    _depthResolveSource.target = target;
    toPhysicalRect(frame, source.resolution, _depthResolveSource.viewport);
    pipe.copyDepth(_depthResolveSource, copy, session);
    _depthResolveSource.target = null!;
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
   * Fills every field of the shared result, so no pass inherits the last one's; reuses `ap.cachedTarget` while
   * the sources match, which misses a cache reset, so `_invalidatePerPassTargets` drops it then
   */
  private _resolveTarget(
    ap: AddedPass,
    passIdx: number,
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
    if (changed || ap.cachedTarget === null) {
      ap.cachedTarget = this._renderTargetCache.get(attachments);
    }
    out.target = ap.cachedTarget;
    if (attachments.colors && out.target !== session.defaultTarget) this._setColorAttachments(out.target, ap, passIdx);
    out.frame = frame;
    return out;
  }

  /**
   * Content UV `(min, max)`, inset half a texel, so `min + max` is the content's extent; `fullscreenEffectShader`
   * relies on both
   * @internal
   */
  public _inputClamp(handle: ResourceHandle, session: RenderSession, out: Float32Array): void {
    if (this._resources[handle._id].kind !== 'transient') {
      throw new Error(`RenderGraph._inputClamp: resource ${handle._id} is imported, not a transient`);
    }
    const { frame, source } = this.getTexture(handle, session);
    const halfX = 0.5 / source.pixelWidth;
    const halfY = 0.5 / source.pixelHeight;
    out[0] = halfX;
    out[1] = halfY;
    out[2] = frame.width / source.pixelWidth - halfX;
    out[3] = frame.height / source.pixelHeight - halfY;
  }

  /**
   * `RenderTargetCache.reset` destroys its targets while pooled sources keep their identity, so a
   * source check alone would keep a destroyed target
   */
  private _invalidatePerPassTargets(): void {
    for (let i = 0; i < this._passes.length; i++) this._passes[i].cachedTarget = null;
    for (const cameraTarget of this._cameraTargets.values()) cameraTarget.draw = null;
    this._sceneDrawTarget = null;
  }

  /**
   * Seeds pixi's own target, since on WebGPU a second target over the canvas reconfigures it and destroys the
   * frame's swap-chain texture; re-seeds only when the key's sources differ, which a cache reset forces
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
   * Runs on every bind, since one cached target can back different handles within a frame; never on the view's
   * own target, whose attachments belong to the app or pixi
   */
  private _setColorAttachments(target: RenderTarget, ap: AddedPass, passIdx: number): void {
    const colors = target.colorAttachments;
    const several = colors.length > 1;
    for (let i = 0; i < colors.length; i++) {
      const attachment = colors[i];
      const id = ap.colorHandles[i]._id;
      const value = this._clearValueById[id];
      if (attachment.clearValue !== value) attachment.clearValue = value;
      if (several) {
        const loadOp = this._effectiveLoadOp(id, passIdx);
        if (attachment.loadOp !== loadOp) attachment.loadOp = loadOp;
      }
    }
  }

  private _resolveClear(ap: AddedPass, passIdx: number): CLEAR {
    const accesses = ap.record.accesses;
    let clearColor = false;
    let clearDepth = false;
    for (let i = 0; i < accesses.length; i++) {
      const access = accesses[i];
      if (access.mode !== 'write_attachment') continue;
      if (this._effectiveLoadOp(access.handle._id, passIdx) !== 'clear') continue;
      if (access.handle._kind === 'color') clearColor = true;
      else if (access.handle._kind === 'depth') clearDepth = true;
    }

    if (clearColor && clearDepth) return CLEAR.ALL;
    if (clearColor) return CLEAR.COLOR;
    if (clearDepth) return CLEAR.DEPTH;
    return CLEAR.NONE;
  }

  private _effectiveLoadOp(id: number, passIdx: number): 'load' | 'clear' {
    if (this._firstWriterByResId[id] !== passIdx) return 'load';
    const entry = this._resources[id];
    if (entry.kind === 'transient') return 'clear';
    if (id === this.defaultDepth._id) return 'clear';
    return 'load';
  }

  /**
   * `-1` is not seen yet, so the default depth `_prepareDefaultTarget` creates later doesn't read as a swap. A resize
   * resets the cache too, since targets at the old size would never bind again.
   * Each reset puts `Texture.EMPTY` back in the default key, or `_prepareDefaultTarget` wouldn't re-seed pixi's target.
   */
  private _maybeResetRenderTargetCache(session: RenderSession): void {
    const colorTex = session.defaultTarget.colorTexture.source;
    const depthTex = session.defaultTarget.depthStencilTexture?.source;
    const colorUid = colorTex.uid;
    const depthUid = depthTex ? depthTex.uid : -1;
    const colorChanged = this._lastColorUid !== -1 && colorUid !== this._lastColorUid;
    const depthChanged = this._lastDepthUid !== -1 && depthUid !== this._lastDepthUid;
    const resized =
      this._lastWidth !== -1 && (colorTex.pixelWidth !== this._lastWidth || colorTex.pixelHeight !== this._lastHeight);
    if (colorChanged || depthChanged || resized) {
      this._renderTargetCache.reset();
      this._invalidatePerPassTargets();
      this._defaultCacheKey.colors![0].texture = Texture.EMPTY.source;
      this._defaultCacheKey.depth!.texture = Texture.EMPTY.source;
    }
    this._lastColorUid = colorUid;
    this._lastDepthUid = depthUid;
    this._lastWidth = colorTex.pixelWidth;
    this._lastHeight = colorTex.pixelHeight;
  }

  /**
   * Puts placeholders back in every transient sample binding, so none holds a texture the pool destroys; `destroy`
   * runs it too, since the view's global bind group outlives the graph
   * @internal
   */
  public _releaseTransients(): void {
    for (let i = 0; i < this._passes.length; i++) {
      const sampleAccesses = this._passes[i].sampleAccesses;
      for (let j = 0; j < sampleAccesses.length; j++) {
        const a = sampleAccesses[j];
        if (this._resources[a.handle._id].kind !== 'transient') continue;
        const binding = a.binding!;
        const placeholder = a.handle._kind === 'depth' ? DEPTH_VIEW_PLACEHOLDER : Texture.EMPTY.source;
        binding.group.setResource(placeholder, binding.slot);
        if (binding.styleSlot !== undefined) binding.group.setResource(Texture.EMPTY.source.style, binding.styleSlot);
      }
    }
  }
}
