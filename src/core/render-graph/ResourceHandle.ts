import type { TEXTURE_FORMATS } from 'pixi.js';

/**
 * Discriminant keeping colour and depth resource handles distinct in the type system
 * @category rendering
 * @advanced
 */
export type ResourceKind = 'color' | 'depth';

/**
 * Tiny opaque value identifying a render-graph resource
 *
 * `_id` indexes the graph's resource table; `_kind` keeps colour and depth
 * handles distinct in the type system.
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
 * Descriptor for a graph-allocated transient
 *
 * Returned by the callback passed to {@link RenderGraph#createColor} /
 * {@link RenderGraph#createDepth}; the graph reallocates the backing
 * `TextureSource` only when a field changes. Uses pixi's `TEXTURE_FORMATS` so
 * it flows straight into `new TextureSource({ format })`.
 * @internal
 */
export interface ResourceDescriptor {
  /** Requested texture width in pixels */
  width: number;
  /** Requested texture height in pixels */
  height: number;
  /** Texture format, forwarded to the `TextureSource` */
  format: TEXTURE_FORMATS;
  /** Generate mipmaps on upload; default `false` */
  autoGenerateMipmaps?: boolean;
  /** Texture sampling filter; default `'linear'` */
  scaleMode?: 'nearest' | 'linear';
  /** Optional debug label propagated to the `TextureSource` */
  label?: string;
}

/**
 * Options for a graph-allocated texture — the shape every screen-space intermediate wants
 *
 * Reads like a pixi `TextureSourceOptions`: `width` and `height` are the logical size and
 * `resolution` multiplies them into texels. The engine supplies the defaults: the logical size
 * is the view's viewport and the resolution is the view's own, so `{}` is the physical viewport.
 * Viewport-sized textures are capped at the framebuffer and pooled in power-of-two buckets like
 * the built-in copies; an explicit size is allocated as asked.
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
   * Generate mipmaps after each write
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
