import { Texture } from 'pixi.js';
import type { Container, Matrix, Renderer } from 'pixi.js';

import { ContainerSource } from './ContainerSource';
import type { ContainerSourceOptions } from './ContainerSource';

/**
 * Options for {@link ContainerTexture} — identical to {@link ContainerSourceOptions}
 * @category rendering
 * @standard
 */
export type ContainerTextureOptions = ContainerSourceOptions;

/**
 * A {@link Texture} whose pixels are a live 2D PixiJS {@link Container}
 *
 * The ergonomic, one-texture front end for {@link ContainerSource}. Construction makes a
 * `ContainerSource` and a single full-frame `Texture` view over it; assign it to any material
 * texture slot, on any geometry.
 *
 * The live machinery (reparenting, render-into-framebuffer) lives on the source; this class just forwards
 * to it. When you need several views over the same live container, build a {@link ContainerSource} directly
 * and create your own `Texture`s from it.
 *
 * By default nothing drives it for you: call {@link ContainerTexture#render} when you want the texture
 * redrawn — once after setup, or every frame for animated content. Pass the renderer, or retain one via the
 * `renderer` option so you can call `render()` with no argument. It is otherwise an ordinary `Texture` you own
 * and `destroy()` like any other. A manual `render()` must run at a safe point (before you render your scene),
 * never inside a render pass.
 *
 * For animated content you can instead opt in to {@link ContainerTexture#autoUpdate} (needs a retained
 * `renderer`), which re-renders every frame off `Ticker.shared`, sequenced just before the application's
 * render.
 *
 * **Render at least once before the texture is sampled** — a fresh render target is empty (transparent/black)
 * until its first draw, so a mesh using a never-rendered ContainerTexture shows black. Passing a `renderer`
 * does this for you once on construction by default (see {@link ContainerTextureOptions#firstRender}).
 *
 * The capture is stored screen-oriented (it renders with Pixi's `flipY`), so it samples **upright on 3D
 * geometry** with ordinary UVs — no per-material flip needed. Presenting it on a 2D `Sprite` instead needs a
 * vertical flip (`sprite.scale.y = -1`), since the capture is oriented for 3D, not for 2D sprites.
 * @example
 * ```ts
 * // Manual: draw it once after setup.
 * const ui = new ContainerTexture({ container: myHud, resolution: 2 });
 * mesh.material = new FlatMaterial({ baseColorTexture: ui });
 * ui.render(renderer);
 *
 * // Self-driving: retain the renderer, render once now, then re-render every frame.
 * const live = new ContainerTexture({ container: myHud, renderer, firstRender: true, autoUpdate: true });
 * ```
 * @category rendering
 * @standard
 */
export class ContainerTexture extends Texture {
  constructor(options: ContainerTextureOptions) {
    super({ source: new ContainerSource(options) });
  }

  /** The {@link ContainerSource} backing this texture */
  public get containerSource(): ContainerSource {
    return this.source as ContainerSource;
  }

  /** The 2D {@link Container} drawn into this texture */
  public get container(): Container {
    return this.containerSource.container;
  }

  /** The retained {@link Renderer}, or `null`; see {@link ContainerSource#renderer} */
  public get renderer(): Renderer | null {
    return this.containerSource.renderer;
  }

  /**
   * Retains a renderer for parameterless {@link ContainerTexture#render} calls, or `null` to release it
   * @param value - Renderer to retain, or `null` to release it
   */
  public set renderer(value: Renderer | null) {
    this.containerSource.renderer = value;
  }

  /** Whether the texture re-renders every frame off `Ticker.shared`; see {@link ContainerSource#autoUpdate} */
  public get autoUpdate(): boolean {
    return this.containerSource.autoUpdate;
  }

  /**
   * Starts or stops the per-frame re-render; requires a retained {@link ContainerTexture#renderer}
   * @param value - `true` to re-render every frame, `false` to stop
   */
  public set autoUpdate(value: boolean) {
    this.containerSource.autoUpdate = value;
  }

  /** The capture transform applied to the container (offset/scale); see {@link ContainerSource#transform} */
  public get transform(): Matrix {
    return this.containerSource.transform;
  }

  /**
   * Replaces the capture transform; takes effect on the next render
   * @param value - The new capture transform
   */
  public set transform(value: Matrix) {
    this.containerSource.transform = value;
  }

  /**
   * Swaps the {@link Container} this texture renders
   *
   * See {@link ContainerSource#setContainer}.
   * @param container - The new container to render
   */
  public setContainer(container: Container): void {
    this.containerSource.setContainer(container);
  }

  /**
   * Renders the container into this texture
   *
   * You own when this happens — call it once after setup (the texture is empty/black until its first
   * render), or each frame for animated content. Pass a `renderer`, or omit it to use the retained one (see
   * {@link ContainerTexture#renderer}). Must be called at a safe point (before you render your scene), never
   * inside a render pass.
   * @param renderer - Renderer to draw with; omit to use the retained one
   */
  public render(renderer?: Renderer): void {
    this.containerSource.render(renderer);
  }

  /**
   * Tears down this texture view
   *
   * The boolean follows pixi's {@link Texture#destroy} `destroySource` contract: `destroy(true)` also frees
   * the backing {@link ContainerSource} (its render target), while `destroy()` / `destroy(false)` leaves the
   * source alive — sources are shareable and a material's `destroy({ texture: true })` calls `destroy(false)`
   * to keep the source. Pass `{ source, container }` to additionally destroy the reparented 2D `container`
   * and its children (which implies freeing the source, since the source has nothing left to render).
   * @param options - `true` also frees the source; an object picks `source` and `container` separately
   */
  public override destroy(
    options:
      | boolean
      | {
          /** Also free the backing {@link ContainerSource} (its render target) */
          source?: boolean;
          /** Also destroy the reparented 2D container and its children; implies freeing the source */
          container?: boolean;
        } = false,
  ): void {
    const destroySource = typeof options === 'boolean' ? options : (options.source ?? false);
    const destroyContainer = typeof options === 'boolean' ? false : (options.container ?? false);

    // Free the source exactly once, here — never via super.destroy(true) — so it isn't double-freed when
    // both this and a material's source loop run. Destroying the container implies freeing the source.
    if (destroySource || destroyContainer) {
      this.containerSource.destroy(destroyContainer);
    }

    super.destroy(false);
  }
}
