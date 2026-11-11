import type { TEXTURE_FORMATS } from 'pixi.js';

/**
 * Whether a {@link ResourceHandle} names a colour or a depth texture
 * @category rendering
 * @advanced
 */
export type ResourceKind = 'color' | 'depth';

/**
 * Names one texture in a {@link RenderGraph}; the texture behind it can change from frame to frame
 *
 * Declare it in a pass's `setup`, and get the texture in `render` with {@link RenderGraph#getTexture}.
 * A handle works only in the graph that made it.
 * @category rendering
 * @advanced
 */
export interface ResourceHandle<K extends ResourceKind = ResourceKind> {
  readonly _kind: K;
  readonly _id: number;
}

/**
 * Handle to a colour resource in the render graph
 * @category rendering
 * @advanced
 */
export type ColorHandle = ResourceHandle<'color'>;

/**
 * Handle to a depth resource in the render graph
 * @category rendering
 * @advanced
 */
export type DepthHandle = ResourceHandle<'depth'>;

/** @internal */
export interface ResourceDescriptor {
  width: number;
  height: number;
  format: TEXTURE_FORMATS;
  autoGenerateMipmaps?: boolean;
  antialias?: boolean;
  scaleMode?: 'nearest' | 'linear';
  label?: string;
}

/**
 * Options for a texture the graph allocates, such as an effect's intermediate
 *
 * Sized as in pixi: `width` and `height` are logical pixels, and `resolution` multiplies them into
 * texels. `{}` gives a texture the size of the scene colour.
 *
 * The texture comes from pixi's `TexturePool`, which rounds its size up, to the next power of two or
 * to the canvas size. The content sits at the texture's origin, and `texture.frame` gives its size.
 * @category rendering
 * @advanced
 */
export interface TransientTextureOptions {
  /**
   * Width in logical pixels
   * @default the view's viewport width
   */
  width?: number;
  /**
   * Height in logical pixels
   * @default the view's viewport height
   */
  height?: number;
  /**
   * Texels per logical pixel, as on pixi's render textures
   *
   * `'inherit'` follows the scene's, {@link RenderGraph#resolution}. A number is absolute: `1` is
   * half the physical size on a DPR 2 screen, a common choice for a cheaper blur or AO.
   * @default 'inherit'
   */
  resolution?: number | 'inherit';
  /**
   * Texture format
   * @default the scene colour's format for colour, or the view target's when the scene colour has
   *   none of its own; `'depth24plus-stencil8'` for depth
   */
  format?: TEXTURE_FORMATS;
  /**
   * Whether the texture has a mip chain, which the graph fills after the pass that last writes it each
   * frame; a depth texture's mips stay empty
   * @default false
   */
  autoGenerateMipmaps?: boolean;
  /**
   * Whether the texture is multisampled, which smooths the edges of the triangles drawn into it
   *
   * Only a texture scene passes draw meshes into needs it: an effect's output is one fullscreen
   * triangle with no edges to smooth, and the samples take four times the texture's memory. Passes
   * sample it like any other texture, since the graph resolves it after it's written, but each
   * sampled depth costs a copy into a single-sample texture every frame.
   * @default false
   */
  antialias?: boolean;
  /**
   * Sampling filter
   * @default 'linear' for colour, 'nearest' for depth
   */
  scaleMode?: 'nearest' | 'linear';
  /** Debug label, which also names the texture in errors */
  label?: string;
}
