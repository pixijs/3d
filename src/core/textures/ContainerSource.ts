import { Container, Matrix, TextureSource, Ticker, UPDATE_PRIORITY, warn } from 'pixi.js';
import type { Renderer } from 'pixi.js';

/**
 * Options for {@link ContainerSource} (and, via {@link ContainerTextureOptions}, for {@link ContainerTexture})
 * @category rendering
 * @standard
 */
export interface ContainerSourceOptions {
  /** The 2D {@link Container} rendered into this source's pixels; reparented out of any existing parent */
  container: Container;
  /**
   * Source pixel width. Omitted → measured from the `container`'s local bounds at construction. When *both*
   * `width` and `height` are omitted the capture also offsets to the container's top-left, so an off-origin
   * container is captured as authored. Pass an explicit `width` AND `height` for a fixed (0,0)→(w,h) window.
   */
  width?: number;
  /** Source pixel height; see {@link ContainerSourceOptions#width} for the auto-measure / offset behaviour */
  height?: number;
  /** Source resolution (pixel density) */
  resolution?: number;
  /** Antialias the render target */
  antialias?: boolean;
  /**
   * Transform applied when capturing the `container` into the texture, for a fixed explicit-size window — use
   * it to offset (and/or scale) a container that isn't authored at the origin, e.g.
   * `new Matrix().translate(128, 128)` to capture a 256×256 square centred on the origin. When set, it always
   * wins; when omitted with an explicit size the capture stays identity (an off-origin container clips); when
   * omitted with auto-measure (no `width`/`height`) the capture offsets to the container's bounds. The capture
   * is never auto-fit *per frame*, so nothing shifts as the container animates. Sets the initial value of the
   * runtime-mutable {@link ContainerSource#transform}.
   */
  transform?: Matrix;
  /**
   * Renderer to retain on the source. Storing it lets you call {@link ContainerSource#render} with no
   * argument, and is required for {@link ContainerSourceOptions#firstRender} and
   * {@link ContainerSourceOptions#autoUpdate}. Optional — pass the renderer to each `render()` call instead if
   * you'd rather not retain a reference.
   */
  renderer?: Renderer;
  /**
   * Render once immediately during construction, so the texture has pixels before it is ever sampled — avoids
   * the empty-until-first-render (black) footgun. **Default `true`**, but it only fires when a
   * {@link ContainerSourceOptions#renderer} is given; without one the default silently no-ops (nothing to
   * render with). Pass `false` to opt out. Setting `true` explicitly without a `renderer` warns.
   */
  firstRender?: boolean;
  /**
   * Re-render the container every frame off `Ticker.shared` (requires {@link ContainerSourceOptions#renderer})
   * For animated content that would otherwise need a manual per-frame `render()` call. Default `false` — the
   * source does nothing on its own and you drive `render()` yourself, which is cheaper for static content.
   * Toggle later via {@link ContainerSource#autoUpdate}. Has no effect without a `renderer` (warns).
   */
  autoUpdate?: boolean;
}

/**
 * A {@link TextureSource} whose pixels are a live 2D PixiJS {@link Container}, rendered into its own render target
 *
 * This is the producer half of the container-as-texture primitive: it owns the GPU resource and
 * the render-into-framebuffer logic, mirroring how `VideoSource` owns a live video.
 *
 * Because the live machinery lives on the source, any number of `Texture` views (different frames /
 * trims) can share one `ContainerSource`. For the common one-texture case use {@link ContainerTexture}.
 *
 * The container is reparented into a private root (removing it from any prior parent, so it is never
 * double-rendered) and drawn by {@link ContainerSource#render}. By default **you** drive that — call it once
 * after setup, or every frame for animated content — passing the renderer (or retaining one via the
 * `renderer` option so you can call `render()` with no argument). For animated content you can instead opt in
 * to {@link ContainerSourceOptions#autoUpdate}, which re-renders every frame off `Ticker.shared`; otherwise
 * the source does nothing on its own: no per-frame cost you didn't ask for, and nothing holding it alive but
 * your own reference. **Render at least once before the source is sampled** — until its first draw the render
 * target is empty (transparent/black), so a mesh using a never-rendered source shows black. Passing a
 * `renderer` does this for you once on construction by default (see {@link ContainerSourceOptions#firstRender}).
 * A manual `render()` must run at a safe point (before you render your scene), never *inside* a render pass (a
 * re-entrant render crashes the GPU backend); `autoUpdate` sequences itself just before the application's
 * render for you. The size is fixed at construction (measured from the container if omitted); use the inherited
 * {@link TextureSource#resize} to change it.
 *
 * The capture renders with Pixi's `flipY` (screen orientation), so it samples **upright on 3D geometry**
 * with ordinary UVs — no per-material flip needed. Orientation is handled at *render* time, not sampling:
 * the projection flip is welded to the winding/cull inversion, so 3D content (a `View3D`) captured inside
 * stays correctly culled.
 *
 * Nothing here depends on 3D: a general 2D primitive.
 * @category rendering
 * @advanced
 */
export class ContainerSource extends TextureSource {
  private _container: Container;

  /** Private identity root that owns the `container` — detaches it from its prior parent */
  private readonly _root: Container;
  /** Capture transform (offset/scale) applied to the container when rendering it into the target */
  private readonly _transform = new Matrix();

  /** Retained renderer enabling argument-less {@link ContainerSource#render}, `firstRender` and `autoUpdate` */
  private _renderer: Renderer | null = null;
  private _autoUpdate = false;
  private _isConnectedToTicker = false;

  /** Bound per-frame callback for `autoUpdate`; identity is stable so `Ticker.shared.remove` can match it */
  private readonly _onTick = (): void => {
    this.render();
  };

  /**
   * Registered with the retained renderer's destroy runner, so a renderer destroyed while retained
   * detaches the auto-update tick and drops the dangling reference instead of rendering through a dead
   * renderer every frame. Must not mutate the runner itself — it fires mid-emit.
   */
  private readonly _onRendererDestroy = {
    destroy: (): void => {
      this._renderer = null;
      this._configureAutoUpdate();
    },
  };

  constructor(options: ContainerSourceOptions) {
    const { container } = options;
    // Only measure the container when a dimension is omitted — getLocalBounds() is expensive.
    const bounds = options.width === undefined || options.height === undefined ? container.getLocalBounds() : undefined;
    const width = Math.max(1, Math.ceil(options.width ?? bounds!.width));
    const height = Math.max(1, Math.ceil(options.height ?? bounds!.height));

    if (options.width === undefined && bounds!.width === 0) {
      warn('ContainerSource: container has zero width bounds and no explicit width; defaulting to 1.');
    }
    if (options.height === undefined && bounds!.height === 0) {
      warn('ContainerSource: container has zero height bounds and no explicit height; defaulting to 1.');
    }

    super({
      width,
      height,
      // `resolution`/`antialias` are optional — forwarding `undefined` would override TextureSource's own
      // defaults (yielding a NaN-sized render target), so default them here.
      resolution: options.resolution ?? 1,
      antialias: options.antialias ?? false,
    });

    this._root = new Container();
    this._root.addChild(container); // reparents out of any existing parent
    this._container = container;
    if (options.transform) {
      this._transform.copyFrom(options.transform);
    } else if (options.width === undefined && options.height === undefined) {
      // Full auto-measure: capture the container as-authored by shifting its top-left to (0,0), so an
      // off-origin container fits. Explicit size keeps the fixed (0,0)→(w,h) window (offset via `transform`).
      this._transform.translate(-bounds!.minX, -bounds!.minY);
    }

    if (options.renderer) {
      this._setRenderer(options.renderer);
    }

    // `firstRender` defaults to true: render once now if a renderer is available, so the texture has pixels
    // before it is ever sampled. The default silently no-ops without a renderer (nothing to render with); only
    // an *explicit* `firstRender: true` with no renderer is a misuse worth warning about.
    if (options.firstRender ?? true) {
      if (this._renderer) {
        this.render();
      } else if (options.firstRender) {
        warn('ContainerSource: `firstRender` was set without a `renderer`; nothing was rendered.');
      }
    }
    if (options.autoUpdate) {
      this.autoUpdate = true;
    }
  }

  /** The 2D {@link Container} drawn into this source */
  public get container(): Container {
    return this._container;
  }

  /**
   * The retained {@link Renderer}, or `null`
   *
   * Set it to enable argument-less {@link ContainerSource#render} and
   * {@link ContainerSource#autoUpdate} after construction; clearing it (`null`) halts an active
   * `autoUpdate`.
   */
  public get renderer(): Renderer | null {
    return this._renderer;
  }

  /**
   * Retains (or clears) the renderer and reconciles the auto-update tick against it
   * @param value - Renderer to retain, or `null` to release it
   */
  public set renderer(value: Renderer | null) {
    this._setRenderer(value);
  }

  /**
   * Whether the source re-renders every frame off `Ticker.shared` (sequenced just before the application's render)
   *
   * Requires a retained {@link ContainerSource#renderer}; enabling it without one warns and stays
   * off. Default `false` — drive {@link ContainerSource#render} yourself for static content. While on, the
   * ticker retains the source (as with an auto-updating `VideoSource`); {@link ContainerSource#destroy} (or
   * setting it `false`) halts the tick.
   */
  public get autoUpdate(): boolean {
    return this._autoUpdate;
  }

  /**
   * Toggles the per-frame render tick; warns when enabled with no retained renderer
   * @param value - `true` to start the per-frame render tick, `false` to stop it
   */
  public set autoUpdate(value: boolean) {
    if (value === this._autoUpdate) return;
    this._autoUpdate = value;
    if (value && !this._renderer) {
      warn('ContainerSource: `autoUpdate` was enabled without a `renderer`; set one to drive it.');
    }
    this._configureAutoUpdate();
  }

  /**
   * The capture transform applied to the container (offset/scale)
   *
   * Mutable: assign a new {@link Matrix}, or mutate the returned one in place, then call
   * {@link ContainerSource#render} to redraw with it.
   */
  public get transform(): Matrix {
    return this._transform;
  }

  /**
   * Copies `value` into the source's own capture-transform instance
   * @param value - Capture transform to copy in
   */
  public set transform(value: Matrix) {
    this._transform.copyFrom(value);
  }

  /**
   * Swaps the {@link Container} this source renders, reparenting the new one into the private root
   *
   * The old container is detached. The source's size is unchanged, and nothing is drawn until you
   * next call {@link ContainerSource#render}. Enables reusing one render target's GPU memory for a
   * different container (e.g. a pooled texture), instead of allocating a new one.
   * @param container - The new container to render
   */
  public setContainer(container: Container): void {
    if (container === this._container) return;
    this._root.removeChildren();
    this._root.addChild(container); // reparents out of its prior parent
    this._container = container;
  }

  /**
   * Renders the container into this source through the capture {@link ContainerSource#transform}
   *
   * You own when this happens — call it once after setup (the source is empty/black until its first render),
   * or each frame for animated content. Pass a `renderer`, or omit it to use the one retained via the
   * `renderer` option / {@link ContainerSource#renderer} (a passed renderer is also retained for later
   * calls). Must be called at a safe point (before you render your scene), never inside another render pass.
   * @param renderer - Renderer to draw with, retained for later calls; omit to use the retained one
   */
  public render(renderer?: Renderer): void {
    const r = renderer ?? this._renderer;
    if (!r) {
      warn('ContainerSource.render: no renderer passed and none retained; nothing was rendered.');
      return;
    }
    this._setRenderer(r);
    r.render({ container: this._root, target: this, clear: true, transform: this._transform, flipY: true });
  }

  /**
   * Destroys this source's render target
   *
   * By default the reparented `container` is left intact (the caller owns it); pass `true` to
   * destroy the `container` and its children too.
   * @param destroyContainer - Also destroy the reparented `container` and its children
   */
  public override destroy(destroyContainer = false): void {
    this._autoUpdate = false;
    this._setRenderer(null);
    this._root.removeChildren(); // hand the container back genuinely detached
    if (destroyContainer) {
      this._container.destroy({ children: true });
    }
    // Destroying the capture root's render group also frees the batchers pixi cached under its instruction set.
    this._root.destroy();
    super.destroy();
  }

  /**
   * Central renderer retention: swaps the destroy-runner hook alongside the reference, so renderer
   * teardown is always observed for as long as a renderer is retained.
   * @param value - Renderer to retain, or `null` to release the current one
   */
  private _setRenderer(value: Renderer | null): void {
    if (value === this._renderer) return;
    this._renderer?.runners.destroy.remove(this._onRendererDestroy);
    this._renderer = value;
    value?.runners.destroy.add(this._onRendererDestroy);
    this._configureAutoUpdate();
  }

  /**
   * Connects or disconnects the per-frame render tick to match `autoUpdate` and renderer availability
   *
   * Idempotent — safe to call on any state change (autoUpdate toggle, renderer swap, destroy).
   */
  private _configureAutoUpdate(): void {
    const shouldTick = this._autoUpdate && this._renderer !== null;
    if (shouldTick === this._isConnectedToTicker) return;
    if (shouldTick) {
      // Run just before the application's render (UPDATE_PRIORITY.LOW), so the capture reflects this frame's
      // container state and is uploaded before the scene that samples it draws.
      Ticker.shared.add(this._onTick, this, UPDATE_PRIORITY.LOW + 1);
    } else {
      Ticker.shared.remove(this._onTick, this);
    }
    this._isConnectedToTicker = shouldTick;
  }
}
