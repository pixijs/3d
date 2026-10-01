import { Texture } from 'pixi.js';
import type { Container, Matrix, Renderer } from 'pixi.js';

import { ContainerSource } from './ContainerSource';
import type { ContainerSourceOptions } from './ContainerSource';

/**
 * Options for {@link ContainerTexture}, the same as {@link ContainerSourceOptions}
 * @example
 * ```ts
 * const options: ContainerTextureOptions = { container: gameUi, width: 512, height: 256 };
 * const screen = new ContainerTexture({ ...options, renderer: app.renderer });
 * ```
 * @category rendering
 * @standard
 */
export type ContainerTextureOptions = ContainerSourceOptions;

/**
 * A {@link Texture} that shows a live 2D PixiJS {@link Container}
 *
 * Use it in any material texture slot, on any geometry. It renders into a render target of its
 * own; to make several textures over one live container, build a {@link ContainerSource} and
 * create `Texture`s from it.
 *
 * Nothing redraws it for you. Call {@link ContainerTexture#render} once after setup for static
 * content, or every frame for animated content, before you render your scene. Pass the renderer
 * each time, or keep one with the `renderer` option and call `render()` with no argument. With a
 * kept renderer, {@link ContainerTexture#autoUpdate} re-renders every frame instead.
 *
 * A texture that was never rendered is transparent black, so a mesh using it draws black. With
 * a `renderer` option, it renders once during construction unless
 * {@link ContainerSourceOptions#firstRender | firstRender} is `false`.
 *
 * The picture is stored upright for 3D geometry with ordinary UVs, so no material needs a flip. On
 * a 2D `Sprite` it shows upside down; set `sprite.scale.y = -1`.
 * @example
 * ```ts
 * const label = new ContainerTexture({ container: labelText, resolution: 2 });
 * sign.material = new FlatMaterial({ baseColorTexture: label });
 * label.render(app.renderer);
 *
 * const screen = new ContainerTexture({ container: gameUi, renderer: app.renderer, autoUpdate: true });
 * monitor.material = new FlatMaterial({ baseColorTexture: screen });
 * ```
 * @category rendering
 * @standard
 */
export class ContainerTexture extends Texture {
  constructor(options: ContainerTextureOptions) {
    super({ source: new ContainerSource(options) });
  }

  /**
   * The {@link ContainerSource} that holds this texture's render target and does the rendering
   * @example
   * ```ts
   * import { Rectangle, Texture } from 'pixi.js';
   *
   * const corner = new Texture({ source: screen.containerSource, frame: new Rectangle(0, 0, 64, 64) });
   * ```
   */
  public get containerSource(): ContainerSource {
    return this.source as ContainerSource;
  }

  /**
   * The 2D {@link Container} drawn into this texture
   * @example
   * ```ts
   * screen.container.addChild(scoreText);
   * screen.render();
   * ```
   */
  public get container(): Container {
    return this.containerSource.container;
  }

  /**
   * The renderer kept for {@link ContainerTexture#render} calls with no argument, or `null`
   *
   * {@link ContainerTexture#autoUpdate} needs one, and stops while it is `null`.
   * @example
   * ```ts
   * screen.renderer = app.renderer;
   * screen.render();
   * ```
   */
  public get renderer(): Renderer | null {
    return this.containerSource.renderer;
  }

  /**
   * Keeps a renderer, or releases it with `null`
   * @param value - Renderer to keep, or `null` to release it
   */
  public set renderer(value: Renderer | null) {
    this.containerSource.renderer = value;
  }

  /**
   * Whether the texture re-renders every frame; {@link ContainerSourceOptions#autoUpdate} has the details
   * @example
   * ```ts
   * screen.autoUpdate = !paused;
   * ```
   */
  public get autoUpdate(): boolean {
    return this.containerSource.autoUpdate;
  }

  /**
   * Starts or stops the per-frame render; warns when turned on with no kept renderer
   * @param value - `true` to re-render every frame, `false` to stop
   */
  public set autoUpdate(value: boolean) {
    this.containerSource.autoUpdate = value;
  }

  /**
   * The matrix applied to the container when it is captured; see {@link ContainerSourceOptions#transform}
   *
   * Assign a new matrix or change this one in place, then render again.
   * @example
   * ```ts
   * screen.transform = new Matrix().translate(-scrollX, 0);
   * screen.render();
   * ```
   */
  public get transform(): Matrix {
    return this.containerSource.transform;
  }

  /**
   * Copies `value` into the texture's capture matrix, for the next render
   * @param value - The new capture transform
   */
  public set transform(value: Matrix) {
    this.containerSource.transform = value;
  }

  /**
   * Swaps the {@link Container} this texture renders, reusing its render target
   *
   * The new container moves out of its current parent and the old one is left detached. The size
   * stays the same, and the old picture stays until the next {@link ContainerTexture#render}.
   * @example
   * ```ts
   * screen.setContainer(pauseMenu);
   * screen.render();
   * ```
   * @param container - The new container to render
   */
  public setContainer(container: Container): void {
    this.containerSource.setContainer(container);
  }

  /**
   * Draws the container into this texture
   *
   * Call it before you render your scene, never from code that runs during a render. A renderer
   * passed here is kept for later calls with no argument; with none passed or kept, it warns and
   * draws nothing.
   * @example
   * ```ts
   * scoreText.text = `${score}`;
   * scoreboard.render(app.renderer);
   * ```
   * @param renderer - Renderer to draw with, kept for later calls; omit to use the kept one
   */
  public render(renderer?: Renderer): void {
    this.containerSource.render(renderer);
  }

  /**
   * Destroys this texture, and optionally its source and its container
   *
   * As with pixi's {@link Texture#destroy}, `destroy()` leaves the {@link ContainerSource} alive,
   * since other textures may share it; a material's `destroy({ texture: true })` relies on that.
   * `destroy(true)` also frees the source's render target. The container is yours unless you pass
   * `{ container: true }`, which destroys it with its children and frees the source too.
   * @example
   * ```ts
   * screen.destroy(true);
   * ```
   * @param options - `true` also frees the source; an object picks `source` and `container` separately
   */
  public override destroy(
    options:
      | boolean
      | {
          /**
           * Also free the {@link ContainerSource} and its render target
           * @example
           * ```ts
           * screen.destroy({ source: true });
           * ```
           */
          source?: boolean;
          /**
           * Also destroy the 2D container and its children, which frees the source too
           * @example
           * ```ts
           * screen.destroy({ container: true });
           * ```
           */
          container?: boolean;
        } = false,
  ): void {
    const destroySource = typeof options === 'boolean' ? options : (options.source ?? false);
    const destroyContainer = typeof options === 'boolean' ? false : (options.container ?? false);

    if (destroySource || destroyContainer) {
      this.containerSource.destroy(destroyContainer);
    }

    super.destroy(false);
  }
}
