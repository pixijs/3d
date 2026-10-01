import type { TEXTURE_FORMATS } from 'pixi.js';

/**
 * Discriminant keeping colour and depth resource handles distinct in the type system
 * @category rendering
 * @advanced
 */
export type ResourceKind = 'color' | 'depth';

/**
 * Opaque value naming one texture in a {@link RenderGraph}
 *
 * The graph hands these out and resolves them to textures each frame. `_kind` keeps colour and
 * depth handles apart in the type system, and `_id` indexes the graph's resource table.
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

/**
 * The pool request for a graph-allocated transient, worked out again each frame
 *
 * The graph builds one from {@link TransientTextureOptions}, or from a camera's render texture,
 * and passes it to `TexturePool.getOptimalTexture` before the transient's first use each frame.
 * @internal
 */
export interface ResourceDescriptor {
  /** Content width in texels; the pooled texture may be wider */
  width: number;
  /** Content height in texels; the pooled texture may be taller */
  height: number;
  /** Texture format */
  format: TEXTURE_FORMATS;
  /** Whether the texture has a mip chain, which the graph fills after the texture's last writer each frame */
  autoGenerateMipmaps?: boolean;
  /** Texture sampling filter; the pool's default is `'linear'` */
  scaleMode?: 'nearest' | 'linear';
  /** Debug label written onto the pooled source while the transient holds it */
  label?: string;
}

/**
 * Options for a graph-allocated texture, such as a screen-space intermediate
 *
 * Reads like a pixi `TextureSourceOptions`: `width` and `height` are the logical size and
 * `resolution` multiplies them into texels. The engine supplies the defaults: the logical size
 * is the view's viewport and the resolution is the view's own, so `{}` is the physical viewport.
 *
 * The texture comes from pixi's `TexturePool`. Its content is the size asked for, at the
 * texture's origin, and the texture itself is rounded up to the next power of two, or to the
 * canvas size when that fits and is smaller.
 * @category rendering
 * @advanced
 */
export interface TransientTextureOptions {
  /**
   * Logical width
   * @default the view's viewport width
   */
  width?: number;
  /**
   * Logical height
   * @default the view's viewport height
   */
  height?: number;
  /**
   * Device pixels per logical pixel — pixi's meaning, as on filters and render textures
   *
   * `'inherit'` matches the view's own target. `1` gives one texel per logical pixel: half
   * the physical size on a DPR 2 screen, a third on DPR 3, which is the usual choice for
   * cheaper AO or blur.
   * @default 'inherit'
   */
  resolution?: number | 'inherit';
  /**
   * Texture format
   * @default the view's target format for colour, `'depth24plus-stencil8'` for depth
   */
  format?: TEXTURE_FORMATS;
  /**
   * Whether the texture has a mip chain, which the graph fills after the pass that last writes it each frame
   * @default false
   */
  autoGenerateMipmaps?: boolean;
  /**
   * Sampling filter
   * @default 'linear' for colour, 'nearest' for depth
   */
  scaleMode?: 'nearest' | 'linear';
  /** Debug label propagated to the texture source */
  label?: string;
}
