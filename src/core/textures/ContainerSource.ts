import { Container, Matrix, TextureSource, Ticker, UPDATE_PRIORITY, warn } from 'pixi.js';
import type { Renderer } from 'pixi.js';

/**
 * Options for {@link ContainerTexture} and {@link ContainerSource}
 * @example
 * ```ts
 * const screen = new ContainerTexture({ container: gameUi, width: 512, height: 512, renderer: app.renderer });
 * ```
 * @category rendering
 * @standard
 */
export interface ContainerSourceOptions {
  /**
   * The 2D {@link Container} to draw; it moves out of its current parent, so it stops drawing on the stage
   * @example
   * ```ts
   * const badge = new ContainerTexture({ container: badgeGraphics, renderer: app.renderer });
   * ```
   */
  container: Container;
  /**
   * Width of the capture in logical pixels
   *
   * Omitted, it is measured from the container's local bounds at construction, and is never below 1.
   * When `width` and `height` are both omitted, the capture also moves the container's top-left
   * corner to the origin, so a container drawn away from (0, 0) is captured whole. Given both, the
   * capture is the window from (0, 0) to (`width`, `height`), and
   * {@link ContainerSourceOptions#transform} moves the container into it.
   * @example
   * ```ts
   * const banner = new ContainerTexture({ container: bannerText, width: 1024, height: 256 });
   * ```
   */
  width?: number;
  /**
   * Height of the capture in logical pixels, measured when omitted as
   * {@link ContainerSourceOptions#width} describes
   * @example
   * ```ts
   * const banner = new ContainerTexture({ container: bannerText, width: 1024, height: 256 });
   * ```
   */
  height?: number;
  /**
   * Texels per logical pixel; `2` gives a sharper texture for four times the memory
   * @example
   * ```ts
   * const label = new ContainerTexture({ container: labelText, resolution: 2 });
   * ```
   * @default 1
   */
  resolution?: number;
  /**
   * Whether to multisample the render target, which smooths the edges of shapes drawn into it
   * @example
   * ```ts
   * const chart = new ContainerTexture({ container: pieChart, antialias: true });
   * ```
   * @default false
   */
  antialias?: boolean;
  /**
   * Matrix applied to the container when it is captured, to move or scale it into the window
   *
   * `new Matrix().translate(128, 128)` captures a 256 × 256 window centred on the container's
   * origin. When given, it always wins. When omitted, the capture applies no transform if you gave
   * a size, and moves the container's top-left corner to the origin if you didn't. The capture
   * never refits itself, so nothing shifts as the container animates. Change it later through the
   * texture's `transform` property.
   * @example
   * ```ts
   * const radar = new ContainerTexture({
   *   container: radarDisc,
   *   width: 256,
   *   height: 256,
   *   transform: new Matrix().translate(128, 128),
   * });
   * ```
   */
  transform?: Matrix;
  /**
   * Renderer to keep for `render()` calls with no argument
   *
   * {@link ContainerSourceOptions#firstRender} and {@link ContainerSourceOptions#autoUpdate} need it.
   * Leave it out to pass a renderer to every `render()` call instead.
   * @example
   * ```ts
   * const screen = new ContainerTexture({ container: gameUi, renderer: app.renderer });
   *
   * screen.render();
   * ```
   */
  renderer?: Renderer;
  /**
   * Whether to render once during construction, so the texture has a picture before anything samples it
   *
   * It only happens when {@link ContainerSourceOptions#renderer} is given. Without one, the
   * default does nothing and an explicit `true` warns.
   * @example
   * ```ts
   * const screen = new ContainerTexture({ container: gameUi, renderer: app.renderer, firstRender: false });
   * ```
   * @default true
   */
  firstRender?: boolean;
  /**
   * Whether to re-render the container every frame, for animated content
   *
   * It needs a {@link ContainerSourceOptions#renderer}; without one it warns and waits until one is
   * set. Leave it off for static content and call `render()` when the container changes.
   *
   * It renders from `Ticker.shared` one priority step above where an application renders. That
   * captures before the scene draws only when the application renders from `Ticker.shared`
   * (`sharedTicker: true`). A default application renders from its own ticker, and the texture then
   * shows the previous frame's capture.
   * @example
   * ```ts
   * const screen = new ContainerTexture({ container: gameUi, renderer: app.renderer, autoUpdate: true });
   * ```
   * @default false
   */
  autoUpdate?: boolean;
}

/**
 * A {@link TextureSource} whose pixels are a live 2D PixiJS {@link Container}
 *
 * The source behind {@link ContainerTexture}, whose docs cover when to render, the first render
 * and which way up the picture is. Build one yourself to make several `Texture`s, each with its
 * own frame, over one live container that renders once for all of them.
 *
 * It owns its render target the way a `VideoSource` owns its video, and nothing in it depends on
 * 3D. The size is fixed at construction; the inherited {@link TextureSource#resize} changes it.
 * @example
 * ```ts
 * import { Rectangle, Texture } from 'pixi.js';
 *
 * const sheet = new ContainerSource({ container: icons, width: 256, height: 128, renderer: app.renderer });
 * const play = new Texture({ source: sheet, frame: new Rectangle(0, 0, 128, 128) });
 * const pause = new Texture({ source: sheet, frame: new Rectangle(128, 0, 128, 128) });
 * ```
 * @category rendering
 * @advanced
 */
export class ContainerSource extends TextureSource {
  private _container: Container;

  /**
   * Parent of the container, and what the capture renders
   *
   * Destroyed with the source, which also frees the batchers pixi keeps for its render group.
   */
  private readonly _root: Container;
  private readonly _transform = new Matrix();

  private _renderer: Renderer | null = null;
  private _autoUpdate = false;
  private _isConnectedToTicker = false;

  private readonly _onTick = (): void => {
    this.render();
  };

  /**
   * Hook on the kept renderer's destroy runner: drops the renderer and stops the tick, so a
   * destroyed renderer is never rendered through. It must not add to or remove from the runner,
   * which calls it mid-emit.
   */
  private readonly _onRendererDestroy = {
    destroy: (): void => {
      this._renderer = null;
      this._configureAutoUpdate();
    },
  };

  constructor(options: ContainerSourceOptions) {
    const { container } = options;
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
      resolution: options.resolution ?? 1,
      antialias: options.antialias ?? false,
    });

    this._root = new Container();
    this._root.addChild(container);
    this._container = container;
    if (options.transform) {
      this._transform.copyFrom(options.transform);
    } else if (options.width === undefined && options.height === undefined) {
      this._transform.translate(-bounds!.minX, -bounds!.minY);
    }

    if (options.renderer) {
      this._setRenderer(options.renderer);
    }

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
   * The renderer kept for {@link ContainerSource#render} calls with no argument, or `null`
   *
   * Clearing it stops {@link ContainerSource#autoUpdate} until another is set.
   */
  public get renderer(): Renderer | null {
    return this._renderer;
  }

  /**
   * Keeps a renderer, or releases it with `null`
   * @param value - Renderer to keep, or `null` to release it
   */
  public set renderer(value: Renderer | null) {
    this._setRenderer(value);
  }

  /**
   * Whether the source re-renders every frame from `Ticker.shared`
   *
   * {@link ContainerSourceOptions#autoUpdate} covers the renderer it needs and when the capture runs.
   * While it is on, the ticker holds a reference to the source, as with an auto-updating
   * `VideoSource`; turning it off or destroying the source releases it.
   */
  public get autoUpdate(): boolean {
    return this._autoUpdate;
  }

  /**
   * Starts or stops the per-frame render; warns when turned on with no kept renderer
   * @param value - `true` to re-render every frame, `false` to stop
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
   * The matrix applied to the container when it is captured; see {@link ContainerSourceOptions#transform}
   *
   * Assign a new {@link Matrix} or change this one in place, then call {@link ContainerSource#render}
   * to redraw with it.
   */
  public get transform(): Matrix {
    return this._transform;
  }

  /**
   * Copies `value` into the source's own matrix
   * @param value - Capture transform to copy in
   */
  public set transform(value: Matrix) {
    this._transform.copyFrom(value);
  }

  /**
   * Swaps the {@link Container} this source renders, reusing its render target
   *
   * The new container moves out of its current parent and the old one is left detached. The size
   * stays the same, and the old picture stays until the next {@link ContainerSource#render}. A pool
   * of these reuses GPU memory across containers instead of allocating a source per container.
   * @param container - The new container to render
   */
  public setContainer(container: Container): void {
    if (container === this._container) return;
    this._root.removeChildren();
    this._root.addChild(container);
    this._container = container;
  }

  /**
   * Renders the container into this source through its {@link ContainerSource#transform}
   *
   * Call it before you render your scene, never from code that runs during a render. A renderer
   * passed here is kept for later calls with no argument; with none passed or kept, it warns and
   * draws nothing.
   *
   * It renders with pixi's `flipY`, which stores the picture upright for 3D geometry with ordinary
   * UVs. Pixi flips the face winding along with the projection, so a `View3D` inside the container
   * still culls the right faces.
   * @param renderer - Renderer to draw with, kept for later calls; omit to use the kept one
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
   * Destroys this source's render target, stops {@link ContainerSource#autoUpdate} and releases the
   * kept renderer
   *
   * The container comes back detached and intact, since you own it; pass `true` to destroy it and
   * its children too.
   * @param destroyContainer - Also destroy the container and its children
   */
  public override destroy(destroyContainer = false): void {
    this._autoUpdate = false;
    this._setRenderer(null);
    this._root.removeChildren();
    if (destroyContainer) {
      this._container.destroy({ children: true });
    }
    this._root.destroy();
    super.destroy();
  }

  /**
   * Keeps `value`, moving the destroy hook with it so the kept renderer's teardown is always seen
   * @param value - Renderer to keep, or `null` to release the current one
   */
  private _setRenderer(value: Renderer | null): void {
    if (value === this._renderer) return;
    this._renderer?.runners.destroy.remove(this._onRendererDestroy);
    this._renderer = value;
    value?.runners.destroy.add(this._onRendererDestroy);
    this._configureAutoUpdate();
  }

  /**
   * Adds or removes the per-frame tick to match `autoUpdate` and the kept renderer; safe to call on any change
   *
   * The tick runs at `UPDATE_PRIORITY.LOW + 1`, one step above an application's render, which
   * {@link ContainerSourceOptions#autoUpdate} explains.
   */
  private _configureAutoUpdate(): void {
    const shouldTick = this._autoUpdate && this._renderer !== null;
    if (shouldTick === this._isConnectedToTicker) return;
    if (shouldTick) {
      Ticker.shared.add(this._onTick, this, UPDATE_PRIORITY.LOW + 1);
    } else {
      Ticker.shared.remove(this._onTick, this);
    }
    this._isConnectedToTicker = shouldTick;
  }
}
