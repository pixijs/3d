import { Texture } from 'pixi.js';
import type { Color, ColorSource, Container, Matrix, Renderer } from 'pixi.js';

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
 * Use it in any material texture slot, on any geometry. To make several textures over one
 * container, build a {@link ContainerSource} and create `Texture`s from it.
 *
 * Unless {@link ContainerTexture#autoUpdate | autoUpdate} is on, nothing redraws it. Call
 * {@link ContainerTexture#render} after setup and after each change, before you render your scene,
 * or keep a renderer and set `autoUpdate` for animated content. Until its first render it's
 * transparent black; a `renderer` option renders it once as it's made, unless
 * {@link ContainerSourceOptions#firstRender | firstRender} is `false`.
 *
 * In an opaque material, the parts the container leaves empty draw black;
 * {@link ContainerSourceOptions#clearColor | clearColor} says how to keep their edges smooth.
 *
 * The picture is stored the other way up from an image texture. It shows upright where `v` grows
 * upward, as on a default {@link PlaneGeometry} or a {@link CubeGeometry}'s sides, and upside down
 * where an image shows upright, as on a {@link SphereGeometry}, a plane with `flipV`, a loaded
 * model or a 2D `Sprite`. On a sprite, `sprite.scale.y = -1` with `sprite.anchor.y = 1` turns it
 * over in place.
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
   * The {@link ContainerSource} behind this texture
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
   * Sets the kept renderer
   * @param value - A renderer, or `null` to release it.
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
   * Sets whether the texture re-renders every frame
   * @param value - `true` to re-render every frame.
   */
  public set autoUpdate(value: boolean) {
    this.containerSource.autoUpdate = value;
  }

  /**
   * The capture matrix {@link ContainerSourceOptions#transform} describes; change it or assign a new
   * one, then render again
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
   * Sets the capture matrix, copying `value`
   * @param value - The new capture matrix.
   */
  public set transform(value: Matrix) {
    this.containerSource.transform = value;
  }

  /**
   * The colour {@link ContainerSourceOptions#clearColor} describes; set it or change this one in place,
   * then render again
   * @example
   * ```ts
   * screen.clearColor = 'black';
   * screen.render();
   * ```
   */
  public get clearColor(): Color {
    return this.containerSource.clearColor;
  }

  /**
   * Sets the colour the next render clears to
   * @param value - Any {@link ColorSource}, such as `'black'`.
   */
  public set clearColor(value: ColorSource) {
    this.containerSource.clearColor = value;
  }

  /**
   * Swaps the {@link Container} this texture renders, keeping its render target and size
   *
   * A container other than the current one leaves its parent, the old one is left detached, and the
   * old picture stays until the next {@link ContainerTexture#render}.
   * @example
   * ```ts
   * screen.setContainer(pauseMenu);
   * screen.render();
   * ```
   * @param container - The new container to render.
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
   * @param renderer - Renderer to draw with, kept for later calls; omit to use the kept one.
   */
  public render(renderer?: Renderer): void {
    this.containerSource.render(renderer);
  }

  /**
   * Destroys this texture, and optionally its source and its container
   *
   * As with pixi's {@link Texture#destroy}, `destroy()` leaves the {@link ContainerSource} alive,
   * since other textures may share it, and with {@link ContainerTexture#autoUpdate} on, still
   * rendering every frame. `destroy(true)` frees the source too. The container is yours unless you
   * pass `{ container: true }`, which destroys it with its children and frees the source.
   * @example
   * ```ts
   * screen.destroy(true);
   * ```
   * @param options - `true` also frees the source; an object picks `source` and `container` separately.
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
