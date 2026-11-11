import { Color, Container, Matrix, TextureSource, Ticker, UPDATE_PRIORITY, warn } from 'pixi.js';
import type { ColorSource, Renderer, RgbaArray } from 'pixi.js';

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
   * Width of the capture in logical pixels; omitted, it's measured once from the container's local bounds
   *
   * {@link ContainerSourceOptions#transform} says where the container sits in the capture.
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
   * Matrix applied to the container when it's captured, to move or scale it into the capture
   *
   * Omitted, when you give neither `width` nor `height`, it moves the top-left corner of the
   * container's contents, measured once at construction, to the origin; otherwise the capture is
   * the window from (0, 0) to (`width`, `height`). The container's own position, pivot, scale and
   * rotation still apply inside the capture, but the measurement leaves them out, so leave them at
   * their defaults or pass `width`, `height` and `transform` yourself.
   * `new Matrix().translate(128, 128)` centres a 256 × 256 capture on the origin of a container left
   * at its defaults; change it later through the texture's `transform` property.
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
   * Colour the capture fills the texture with before it draws the container
   *
   * Transparent keeps the container's alpha, so the parts it leaves empty show what's behind a
   * material in `alphaMode: 'blend'` or `'mask'`, a {@link Sprite3D} or a 2D `Sprite`. A material in
   * the default `alphaMode: 'opaque'` draws those parts black, and the anti-aliased edges next to them
   * turn hard; pass `'black'` there to keep them smooth. Change it later through the texture's
   * `clearColor` property.
   * @example
   * ```ts
   * const screen = new ContainerTexture({ container: scoreText, clearColor: 'black', renderer: app.renderer });
   * monitor.material = new FlatMaterial({ baseColorTexture: screen });
   * ```
   * @default 'transparent'
   */
  clearColor?: ColorSource;
  /**
   * Renderer to keep for `render()` calls with no argument; {@link ContainerSourceOptions#firstRender}
   * and {@link ContainerSourceOptions#autoUpdate} need it
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
   * Needs {@link ContainerSourceOptions#renderer}; without one, an explicit `true` warns.
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
   * Needs a {@link ContainerSourceOptions#renderer}; without one it warns and waits until one is set.
   * It renders from `Ticker.shared` just before an application that renders from it
   * (`sharedTicker: true`); a default application has its own ticker and shows the previous frame's
   * capture. While it's on, `Ticker.shared` holds the source, so turn it off or destroy the source
   * when you're done.
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
 * The source behind {@link ContainerTexture}, whose docs cover when to render and which way up the
 * picture is. Build one yourself to make several `Texture`s, each with its own frame, over one
 * container that renders once for all of them. {@link TextureSource#resize} changes its size.
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
  private readonly _root: Container;
  private readonly _transform = new Matrix();
  private readonly _clearColor: Color;

  /** {@link ContainerSource#clearColor} premultiplied by its alpha, since the target holds premultiplied colour */
  private readonly _clearRgba: RgbaArray = [0, 0, 0, 1];

  private _renderer: Renderer | null = null;
  private _autoUpdate = false;
  private _isConnectedToTicker = false;

  private readonly _onTick = (): void => {
    this.render();
  };

  /**
   * Sets `_renderer` directly, not through `_setRenderer`, since the runner calls it mid-emit and a
   * remove then would skip the next hook
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
    this._clearColor = new Color(options.clearColor ?? 'transparent');

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

  /** The renderer kept for {@link ContainerSource#render} calls with no argument, or `null` */
  public get renderer(): Renderer | null {
    return this._renderer;
  }

  /**
   * Sets the kept renderer
   * @param value - A renderer, or `null` to release it.
   */
  public set renderer(value: Renderer | null) {
    this._setRenderer(value);
  }

  /** Whether the source re-renders every frame; {@link ContainerSourceOptions#autoUpdate} has the details */
  public get autoUpdate(): boolean {
    return this._autoUpdate;
  }

  /**
   * Sets whether the source re-renders every frame
   * @param value - `true` to re-render every frame.
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
   * The capture matrix {@link ContainerSourceOptions#transform} describes; change it or assign a new
   * one, then render again
   */
  public get transform(): Matrix {
    return this._transform;
  }

  /**
   * Sets the capture matrix, copying `value`
   * @param value - The new capture matrix.
   */
  public set transform(value: Matrix) {
    this._transform.copyFrom(value);
  }

  /**
   * The colour {@link ContainerSourceOptions#clearColor} describes; set it or change this one in place,
   * then render again
   */
  public get clearColor(): Color {
    return this._clearColor;
  }

  /**
   * Sets the colour the next render clears to
   * @param value - Any {@link ColorSource}, such as `'black'`.
   */
  public set clearColor(value: ColorSource) {
    this._clearColor.setValue(value);
  }

  /**
   * Swaps the {@link Container} this source renders, as {@link ContainerTexture#setContainer} describes
   * @param container - The new container to render.
   */
  public setContainer(container: Container): void {
    if (container === this._container) return;
    this._root.removeChildren();
    this._root.addChild(container);
    this._container = container;
  }

  /**
   * Renders the container into this source, as {@link ContainerTexture#render} describes
   * @param renderer - Renderer to draw with, kept for later calls; omit to use the kept one.
   */
  public render(renderer?: Renderer): void {
    const r = renderer ?? this._renderer;
    if (!r) {
      warn('ContainerSource.render: no renderer passed and none retained; nothing was rendered.');
      return;
    }
    this._setRenderer(r);
    const clearColor = this._clearColor.toArray(this._clearRgba);
    const alpha = clearColor[3];
    clearColor[0] *= alpha;
    clearColor[1] *= alpha;
    clearColor[2] *= alpha;
    r.render({ container: this._root, target: this, clear: true, clearColor, transform: this._transform, flipY: true });
  }

  /**
   * Frees the render target and stops {@link ContainerSource#autoUpdate}, leaving the container
   * detached but intact unless you pass `true`
   * @param destroyContainer - Also destroy the container and its children.
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

  private _setRenderer(value: Renderer | null): void {
    if (value === this._renderer) return;
    this._renderer?.runners.destroy.remove(this._onRendererDestroy);
    this._renderer = value;
    value?.runners.destroy.add(this._onRendererDestroy);
    this._configureAutoUpdate();
  }

  /** Ticks one step above an application's render, as {@link ContainerSourceOptions#autoUpdate} states */
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
