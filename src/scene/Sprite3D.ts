import { ObservablePoint, Texture, definedProps } from 'pixi.js';
import type { ColorSource, PointData, TextureSourceLike } from 'pixi.js';

import { PlaneGeometry } from '../geometry/PlaneGeometry';
import type { AlphaMode, BaseMaterial3D } from '../materials/BaseMaterial3D';
import { FlatMaterial } from '../materials/flat/FlatMaterial';
import type { Vector3 } from '../math/vector/Vector3';
import type { Destroy3DOptions } from '../utils/Destroy3DOptions';
import { resolveDestroy3DFlag } from '../utils/Destroy3DOptions';
import { warnOnce } from '../utils/warnOnce';
import type { Size3D } from './Container3D';
import { Mesh3D } from './Mesh3D';
import type { BillboardMode, Mesh3DOptions } from './Mesh3D';

function warnUnsizedTexture(): void {
  warnOnce(
    'pixijs-3d-sprite3d-size-unloaded',
    '[@pixi/3d] A Sprite3D was sized in world units while its texture had no dimensions (still ' +
      'loading?). The write was dropped — size the sprite after the texture resolves, or set ' +
      '`scale` directly.',
  );
}

/**
 * Constructor options for {@link Sprite3D}
 *
 * `texture`, `tint`, `alpha`, `alphaMode` and `alphaCutoff` shape the sprite's material. Without
 * `material` they build the unlit {@link FlatMaterial} the sprite makes; with one, those you set
 * are written into it, `texture` into its `baseColor` slot. The other {@link Mesh3DOptions} apply
 * too, and `label` defaults to `'Sprite3D'`.
 * @example
 * ```ts
 * const markerMaterial = new Material3D({ roughness: 0.8 });
 * const marker = new Sprite3D({
 *   material: markerMaterial,
 *   texture: markerTexture,
 *   alphaMode: 'mask',
 *   label: 'marker',
 *   parent: view.root,
 * });
 * ```
 * @category scene
 * @standard
 */
export interface Sprite3DOptions extends Omit<Mesh3DOptions, 'geometry' | 'material' | 'skeleton' | 'weights'> {
  /**
   * The material to draw the quad with; it needs a `baseColor` texture slot
   *
   * It can be shared between sprites. Left out, the sprite makes an unlit, double-sided
   * {@link FlatMaterial} of its own and frees it on destroy.
   * @example
   * ```ts
   * const leaves = new Material3D({ baseColorTexture: leafTexture, alphaMode: 'mask' });
   * const card = new Sprite3D({ material: leaves, billboardMode: 'cylindrical' });
   * ```
   */
  material?: BaseMaterial3D;
  /**
   * The image on the quad
   *
   * Its untrimmed pixel size times {@link Sprite3DOptions.pixelSize | pixelSize} sets the sprite's
   * world size.
   * @default a passed material's `baseColor` texture, else `Texture.WHITE`
   * @example
   * ```ts
   * const tree = new Sprite3D({ texture: await Assets.load('tree.png') });
   * ```
   */
  texture?: Texture;
  /**
   * Colour multiplied into the texture, any `ColorSource`, as with `Container.tint`
   * @default 0xffffff
   * @example
   * ```ts
   * const glow = new Sprite3D({ texture: glowTexture, tint: 0xffaa33 });
   * ```
   */
  tint?: ColorSource;
  /**
   * Opacity multiplied into the texture's alpha
   * @default 1
   * @example
   * ```ts
   * const smoke = new Sprite3D({ texture: smokeTexture, alpha: 0.5 });
   * ```
   */
  alpha?: number;
  /**
   * How the texture's alpha is used
   *
   * `'blend'` draws the sprite in the transparent pass, which sorts back to front every frame: the
   * right default for soft edges. `'mask'` cuts away pixels below
   * {@link Sprite3DOptions.alphaCutoff | alphaCutoff} in the opaque pass, with depth writes and no
   * sorting, so it batches better than `'blend'`; it's the usual pick for foliage. `'opaque'` draws
   * the whole quad solid.
   * @default 'blend'
   * @example
   * ```ts
   * const leaf = new Sprite3D({ texture: leafTexture, alphaMode: 'mask' });
   * ```
   */
  alphaMode?: AlphaMode;
  /**
   * Alpha below which `'mask'` mode cuts a pixel away
   * @default 0.5
   * @example
   * ```ts
   * const leaf = new Sprite3D({ texture: leafTexture, alphaMode: 'mask', alphaCutoff: 0.3 });
   * ```
   */
  alphaCutoff?: number;
  /**
   * How the quad turns to face the camera; see {@link BillboardMode}
   *
   * Sprites with different modes don't share a draw; the {@link Sprite3D} class notes say when
   * that costs draw calls.
   * @default 'spherical'
   * @example
   * ```ts
   * const tree = new Sprite3D({ texture: treeTexture, billboardMode: 'cylindrical' });
   * ```
   */
  billboardMode?: BillboardMode;
  /**
   * Which point of the image sits on the node's origin, as a fraction of its size, with `y`
   * measured down from the top edge
   *
   * A single number sets both axes. `0.5` centres the image, and `{ x: 0.5, y: 1 }` stands it on
   * the origin. Left out, the texture's `defaultAnchor` applies, as on pixi's 2D `Sprite`; without
   * one it's centred, unlike the 2D `Sprite`'s `(0, 0)`. The {@link Sprite3D} class notes cover how
   * it behaves in each billboard mode.
   * @default 0.5
   * @example
   * ```ts
   * const tree = new Sprite3D({ texture: treeTexture, anchor: { x: 0.5, y: 1 } });
   * ```
   */
  anchor?: PointData | number;
  /**
   * World units per texture pixel, which sets the sprite's size
   *
   * At the default 0.01 a 512 px texture is 5.12 units across, which suits a scene measured in
   * metres.
   * @default 0.01
   * @example
   * ```ts
   * const tile = new Sprite3D({ texture: tileTexture, pixelSize: 1 / 32 });
   * ```
   */
  pixelSize?: number;
  /**
   * The sprite's width in world units, in place of
   * {@link Sprite3DOptions.pixelSize | pixelSize} on this axis
   *
   * Pass only `width` or only `height` and the other follows the texture's aspect ratio:
   * `{ height: 4 }` on a 128×200 texture gives 2.56 × 4. Pass both to stretch the image to that
   * box. It ends up in `scale`, as on pixi's 2D `Sprite`, but unlike there a lone `width` or
   * `height` keeps the aspect ratio; the {@link Sprite3D#width} and {@link Sprite3D#height}
   * accessors set one axis each.
   *
   * It's measured against the texture once, at construction. A texture still loading has no size,
   * so the value is dropped with a warning; size the sprite once it loads.
   * @example
   * ```ts
   * const sign = new Sprite3D({ texture: signTexture, width: 2 });
   * ```
   */
  width?: number;
  /**
   * The sprite's height in world units, in place of
   * {@link Sprite3DOptions.pixelSize | pixelSize} on this axis; see
   * {@link Sprite3DOptions.width} for how it combines with `width`
   * @example
   * ```ts
   * const tree = new Sprite3D({ texture: treeTexture, height: 4 });
   * ```
   */
  height?: number;
  /**
   * Whether the sprite casts shadows
   *
   * Off by default because a billboarded sprite casts the shadow of its unturned quad, which
   * doesn't turn with the camera and can thin to a sliver. In `'none'` mode a sprite casts once it's
   * `'opaque'` or `'mask'` and its front faces the light, though a masked one's shadow doesn't show
   * its holes yet. A blended one, the default, casts nothing.
   * @default false
   * @example
   * ```ts
   * const sign = new Sprite3D({
   *   texture: signTexture,
   *   billboardMode: 'none',
   *   alphaMode: 'opaque',
   *   castShadow: true,
   * });
   * ```
   */
  castShadow?: boolean;
  /**
   * Whether the sprite is shadowed
   *
   * Only a lit material takes shadows, so it does nothing with the default {@link FlatMaterial}.
   * @default true
   * @example
   * ```ts
   * const card = new Sprite3D({ material: litLeaves, receiveShadow: false });
   * ```
   */
  receiveShadow?: boolean;
}

/**
 * A textured quad in the 3D scene, sized from its texture and, by default, turned to face the
 * camera
 *
 * It's `texture pixels × pixelSize` world units across, with the familiar sprite API: `anchor`,
 * `tint`, `alpha`, `width` and `height`, plus `alphaMode` for cutouts. It draws with an unlit
 * {@link FlatMaterial} unless you give it another material; a {@link Material3D} gives a lit
 * billboard, which a flat stand-in needs to match the lighting of the model it replaces.
 *
 * ## Batching
 *
 * Sprites that share a material type, billboard mode, alpha mode and image source, such as the
 * frames of one sprite sheet, draw together as one instanced draw. On WebGPU, sprites with
 * materials of their own, as each sprite makes by default, need more than 16 in a row for that;
 * 16 or fewer draw one each. Switching frames within a sheet costs almost nothing. The opaque pass
 * (`'mask'` and `'opaque'`) groups mixed modes and sources well. The transparent pass (`'blend'`)
 * sorts back to front, so every change of mode or source along that order starts a new draw: give
 * each blended effect one mode and one sprite sheet. Tint, alpha, size and position can vary
 * freely.
 *
 * Turning to face the camera costs no CPU time; the GPU does it. Hundreds to a few thousand
 * sprites is what it's built for. For tens of thousands that you set and forget, fill
 * {@link BatchedMesh3D} slots instead: give each one {@link PlaneGeometry.spriteQuad}, a matrix
 * whose X and Y scale carry the texture's world size, and a `billboardMode`.
 *
 * ## Anchor and origin
 *
 * - `'none'`: the anchor is exact, as on a 2D sprite.
 * - `'cylindrical'`: `anchor.y` is exact, so a tree anchored at its feet turns around its base.
 *   `anchor.x` swings around the spin axis.
 * - `'spherical'`: an off-centre anchor drifts as the camera orbits. The centred default is exact.
 *
 * `origin` is in world size units, texture pixels × `pixelSize` before `scale`, and applies after
 * `anchor`. A 200×400 px texture at the default `pixelSize` is 2 × 4 units, so with the centred
 * anchor `origin = { x: 1, y: 2, z: 0 }` turns the sprite around its top-right corner. Under a
 * billboard mode it behaves like an off-centre anchor.
 *
 * ## Limitations
 *
 * - Children inherit the texture size, so children and `toLocal` work in quad units, where the
 *   image spans -0.5 to 0.5. Treat a sprite as a leaf node.
 * - {@link Container3D#reparentChild | reparentChild} would apply the texture size and anchor
 *   twice, so it isn't supported; plain `addChild` and `removeChild` are fine.
 * - A `ContainerTexture` draws upside down on a sprite.
 * @example
 * ```ts
 * import { Sprite3D, View3D } from '@pixi/3d';
 *
 * const glow = new Sprite3D({ texture: glowTexture, tint: 0xffaa33 });
 * glow.position.set(0, 1.5, 0);
 * view.root.addChild(glow);
 *
 * // A 4-unit-tall tree standing on the ground, cut out rather than blended.
 * // Width follows the texture's aspect ratio.
 * const tree = new Sprite3D({
 *   texture: treeTexture,
 *   billboardMode: 'cylindrical',
 *   anchor: { x: 0.5, y: 1 },
 *   alphaMode: 'mask',
 *   height: 4,
 * });
 *
 * // Later, in world units; each accessor writes one axis of `scale`.
 * tree.height = 6;
 * ```
 * @see {@link Sprite3DOptions} For the constructor options.
 * @category scene
 * @standard
 */
export class Sprite3D extends Mesh3D {
  /**
   * Defaults for every new `Sprite3D`; an option passed as `undefined` keeps its default
   *
   * `tint`, `alpha`, `alphaMode` and `alphaCutoff` apply only to the {@link FlatMaterial} the
   * sprite makes, never to a material you pass.
   * @example
   * ```ts
   * // Author against a 32px-per-unit tile set:
   * Sprite3D.defaultOptions.pixelSize = 1 / 32;
   * ```
   */
  public static defaultOptions: Pick<
    Required<Sprite3DOptions>,
    'billboardMode' | 'tint' | 'alpha' | 'alphaMode' | 'alphaCutoff' | 'pixelSize' | 'castShadow' | 'receiveShadow'
  > = {
    billboardMode: 'spherical',
    tint: 0xffffff,
    alpha: 1,
    alphaMode: 'blend',
    alphaCutoff: 0.5,
    pixelSize: 0.01,
    castShadow: false,
    receiveShadow: true,
  };

  /**
   * Creates a self-contained sprite from a texture, or from anything `Texture.from` accepts: an
   * asset alias or URL already in the cache, an image, a canvas or a `TextureSource`
   *
   * The 3D counterpart of pixi's `Sprite.from`. An alias the cache doesn't have draws nothing, and
   * pixi warns; load the asset first.
   * @example
   * ```ts
   * await Assets.load('tree.png');
   * const tree = Sprite3D.from('tree.png');
   * ```
   * @param source - The texture, or the source to build one from.
   * @param skipCache - Build a fresh texture instead of reusing a cached one for `source`; an alias
   * or URL always comes from the cache.
   * @returns A sprite drawing that texture on its own {@link FlatMaterial}.
   */
  public static from(source: Texture | TextureSourceLike, skipCache = false): Sprite3D {
    if (source instanceof Texture) return new Sprite3D(source);

    return new Sprite3D(Texture.from(source, skipCache) ?? Texture.EMPTY);
  }

  private _texture: Texture;
  private _pixelSize = 0;
  private readonly _anchor: ObservablePoint;
  private readonly _ownsMaterial: boolean;

  /** Only `dynamic` textures get it, as on pixi's 2D `Sprite`, so frame swaps stay cheap */
  private readonly _onTextureUpdate = (): void => {
    this.material._deriveUvFrame();
    this._onUpdate();
  };

  /**
   * Creates a `Sprite3D`; add it under {@link View3D.root | view.root} to draw it
   *
   * A bare `Texture` is short for `{ texture }`, as with pixi's 2D `Sprite`. Throws when a
   * `material` you pass has no `baseColor` slot.
   * @example
   * ```ts
   * const glow = new Sprite3D(glowTexture);
   * ```
   * @param options - Construction options, or the texture to draw; see {@link Sprite3DOptions}.
   */
  constructor(options: Sprite3DOptions | Texture = {}) {
    if (options instanceof Texture) options = { texture: options };

    const explicit = definedProps(options);
    /**
     * `width`, `height` and `parent` stay out of `Mesh3D`'s constructor, which would apply them
     * before the sprite has its texture
     */
    const {
      material: supplied,
      texture,
      tint,
      alpha,
      alphaMode,
      alphaCutoff,
      pixelSize,
      anchor,
      width,
      height,
      parent,
      castShadow,
      receiveShadow,
      billboardMode,
      ...rest
    } = { ...Sprite3D.defaultOptions, ...explicit };

    if (supplied && supplied._slotByName.baseColor === undefined) {
      throw new Error(
        '[Sprite3D] The supplied material has no `baseColor` texture slot, so the sprite has ' +
          'no image to size itself from. Use a material built from a baseColor-bearing bit ' +
          '(FlatMaterial, Material3D, PhongMaterial, ...).',
      );
    }

    super({
      label: 'Sprite3D',
      ...rest,
      geometry: PlaneGeometry.spriteQuad,
      material:
        supplied ??
        new FlatMaterial({
          baseColorTexture: texture ?? Texture.WHITE,
          baseColor: tint,
          alpha,
          alphaMode,
          alphaCutoff,
          doubleSided: true,
        }),
      castShadow,
      receiveShadow,
      billboardMode,
    });

    this._ownsMaterial = supplied === undefined;

    this._pixelSize = pixelSize;
    this._texture = this.material.textures.baseColor ?? Texture.WHITE;
    if (this._texture.dynamic) this._texture.on('update', this._onTextureUpdate);

    if (supplied) {
      if (texture) this.texture = texture;
      if (explicit.tint !== undefined) this.tint = explicit.tint;
      if (explicit.alpha !== undefined) this.alpha = explicit.alpha;
      if (explicit.alphaMode !== undefined) this.alphaMode = explicit.alphaMode;
      if (explicit.alphaCutoff !== undefined) this.alphaCutoff = explicit.alphaCutoff;
    }

    this._anchor = new ObservablePoint({ _onUpdate: () => this._onUpdate() }, 0.5, 0.5);
    const initialAnchor = anchor ?? this._texture.defaultAnchor;
    if (initialAnchor !== undefined) this.anchor = initialAnchor;

    if (width !== undefined || height !== undefined) this._fitSize(width, height);
    parent?.addChild(this);
  }

  private _fitSize(width: number | undefined, height: number | undefined): void {
    const { width: pixelWidth, height: pixelHeight } = this._texture.orig;
    if (pixelWidth === 0 || pixelHeight === 0) {
      warnUnsizedTexture();
      return;
    }

    this.width = width ?? (height! * pixelWidth) / pixelHeight;
    this.height = height ?? (width! * pixelHeight) / pixelWidth;
  }

  /**
   * The image on the quad
   *
   * Assigning another re-sizes the sprite; switching frames within one sprite sheet is cheap. It
   * writes the material's `baseColor` slot, so on a shared material it changes every sprite using
   * it. A sprite follows in-place changes only to a texture that was `dynamic` when it got it, as
   * pixi's 2D `Sprite` does.
   * @example
   * ```ts
   * coin.texture = sheet.textures[`coin_${frame}.png`];
   * ```
   */
  get texture(): Texture {
    return this._texture;
  }

  /**
   * Swaps the image and re-sizes the sprite; rotated sprite sheet frames work too
   * @param value - Image to draw on the quad.
   */
  set texture(value: Texture) {
    if (this._texture === value) return;

    if (this._texture.dynamic) this._texture.off('update', this._onTextureUpdate);
    this._texture = value;
    if (value.dynamic) value.on('update', this._onTextureUpdate);

    this.material.textures.baseColor = value;
    this._onUpdate();
  }

  /**
   * Which point of the image sits on the node's origin, as a fraction of its size, with `y`
   * measured down from the top edge
   *
   * `(0.5, 0.5)` is centred, and `y = 1` stands the sprite on the origin. Assign a point or a
   * single number for both axes, or change it in place. The {@link Sprite3D} class notes cover
   * how it behaves in each billboard mode.
   * @example
   * ```ts
   * tree.anchor.set(0.5, 1);
   * ```
   */
  get anchor(): ObservablePoint {
    return this._anchor;
  }

  /**
   * Sets the anchor from a point or a single number for both axes
   * @param value - Fractions of the image's size, `y` measured from its top edge.
   */
  set anchor(value: PointData | number) {
    if (typeof value === 'number') {
      this._anchor.set(value);
    } else {
      this._anchor.copyFrom(value);
    }
  }

  /**
   * World units per texture pixel, which sets the sprite's size without touching `scale`
   * @example
   * ```ts
   * sprite.pixelSize = 1 / 64;
   * ```
   */
  get pixelSize(): number {
    return this._pixelSize;
  }

  /**
   * Re-sizes the sprite without touching `scale`
   * @param value - World units per texture pixel.
   */
  set pixelSize(value: number) {
    if (this._pixelSize === value) return;
    this._pixelSize = value;
    this._onUpdate();
  }

  /**
   * Colour multiplied into the texture
   *
   * As with `Container.tint`, it takes any `ColorSource` and reads back as a hex number. Opacity
   * is {@link Sprite3D#alpha}. It writes the material's `baseColor`, so on a shared material it
   * recolours every sprite using it.
   * @example
   * ```ts
   * glow.tint = 'orange';
   * ```
   */
  get tint(): number {
    return this.material.baseColor;
  }

  /**
   * Sets the colour multiplied into the texture
   * @param value - Colour to multiply by.
   */
  set tint(value: ColorSource) {
    this.material.baseColor = value;
  }

  /**
   * Opacity multiplied into the texture's alpha
   *
   * It writes the material, so on a shared material it fades every sprite using it.
   * @example
   * ```ts
   * ghost.alpha = 0.4;
   * ```
   */
  get alpha(): number {
    return this.material.alpha;
  }

  /**
   * Sets the opacity multiplied into the texture's alpha
   * @param value - Opacity from 0 to 1.
   */
  set alpha(value: number) {
    this.material.alpha = value;
  }

  /**
   * How the texture's alpha is used; see {@link Sprite3DOptions.alphaMode}
   *
   * A blended sprite casts no shadow. It writes the material, so on a shared material it changes
   * every sprite using it.
   * @example
   * ```ts
   * leaf.alphaMode = 'mask';
   * ```
   */
  get alphaMode(): AlphaMode {
    return this.material.alphaMode;
  }

  /**
   * Sets how the texture's alpha is used
   * @param value - How alpha is used.
   */
  set alphaMode(value: AlphaMode) {
    if (this.material.alphaMode === value) return;
    this.material.alphaMode = value;
  }

  /**
   * Alpha below which `'mask'` mode cuts a pixel away; it writes the material
   * @example
   * ```ts
   * leaf.alphaCutoff = 0.3;
   * ```
   */
  get alphaCutoff(): number {
    return this.material.alphaCutoff;
  }

  /**
   * Sets the alpha below which `'mask'` mode cuts a pixel away
   * @param value - Alpha from 0 to 1.
   */
  set alphaCutoff(value: number) {
    this.material.alphaCutoff = value;
  }

  /**
   * The sprite's width in world units: `|scale.x| × texture width × pixelSize`
   *
   * Assigning writes `scale.x` and leaves {@link Sprite3D#height} alone, as on pixi's 2D `Sprite`;
   * to keep the aspect ratio, pass {@link Sprite3DOptions.width | width} at construction.
   * @example
   * ```ts
   * sign.width = 2;
   * ```
   */
  public override get width(): number {
    return Math.abs(this.scale.x) * this._texture.orig.width * this._pixelSize;
  }

  /**
   * Sets `scale.x` for a width in world units
   * @param value - Width in world units.
   */
  public override set width(value: number) {
    const scale = this._scaleForWorldSize(value, this._texture.orig.width, this.scale.x);
    if (scale !== null) this.scale.x = scale;
  }

  /**
   * The sprite's height in world units: `|scale.y| × texture height × pixelSize`
   *
   * Assigning writes `scale.y` only; see {@link Sprite3D#width}.
   * @example
   * ```ts
   * tree.height = 6;
   * ```
   */
  public override get height(): number {
    return Math.abs(this.scale.y) * this._texture.orig.height * this._pixelSize;
  }

  /**
   * Sets `scale.y` for a height in world units
   * @param value - Height in world units.
   */
  public override set height(value: number) {
    const scale = this._scaleForWorldSize(value, this._texture.orig.height, this.scale.y);
    if (scale !== null) this.scale.y = scale;
  }

  /**
   * Returns the sprite's size in world units, from the texture like {@link Sprite3D#width}
   *
   * A sprite is flat, so `depth` is always 0.
   * @example
   * ```ts
   * const { width, height } = sprite.getSize();
   * ```
   * @param out - Object to write into; a new one when omitted
   * @returns The size, written into `out`
   */
  public override getSize(out: Size3D = { width: 0, height: 0, depth: 0 }): Size3D {
    out.width = this.width;
    out.height = this.height;
    out.depth = 0;

    return out;
  }

  /**
   * Sizes the sprite in world units, from the texture like {@link Sprite3D#width}
   *
   * A single number sets both axes, and a missing `height` takes the width, as in pixi's 2D
   * `Sprite`. A sprite is flat, so any `depth` is ignored.
   * @param value - Target width, or an object with `width` and optional `height`
   * @param height - Target height; defaults to the width
   * @param _depth - Ignored; a sprite is flat
   * @example
   * ```ts
   * sprite.setSize(2, 1);
   * sprite.setSize({ width: 3 }); // 3 × 3
   * ```
   */
  public override setSize(
    value: number | (Pick<Size3D, 'width'> & Partial<Size3D>),
    height?: number,
    _depth?: number,
  ): void {
    if (typeof value === 'object') {
      height = value.height ?? value.width;
      value = value.width;
    } else {
      height ??= value;
    }

    this.width = value;
    this.height = height;
  }

  private _scaleForWorldSize(size: number, pixels: number, currentScale: number): number | null {
    if (pixels === 0) {
      warnUnsizedTexture();

      return null;
    }

    return (size / (pixels * this._pixelSize)) * (Math.sign(currentScale) || 1);
  }

  /**
   * Rebuilds {@link Container3D.localTransform | localTransform} with the texture's world size and
   * the anchor offset in it
   *
   * A texture with no size yet, such as one still loading, shrinks the quad to a point.
   * @advanced
   */
  public override updateLocalTransform(): void {
    const quat = this.quaternion;

    if (this.rotationDirty) {
      this.rotationDirty = false;

      const rx = this.rotation._x;
      const ry = this.rotation._y;
      const rz = this.rotation._z;

      const c1 = Math.cos(rx / 2);
      const c2 = Math.cos(ry / 2);
      const c3 = Math.cos(rz / 2);

      const s1 = Math.sin(rx / 2);
      const s2 = Math.sin(ry / 2);
      const s3 = Math.sin(rz / 2);

      quat._x = s1 * c2 * c3 + c1 * s2 * s3;
      quat._y = c1 * s2 * c3 - s1 * c2 * s3;
      quat._z = c1 * c2 * s3 + s1 * s2 * c3;
      quat._w = c1 * c2 * c3 - s1 * s2 * s3;
    }

    const x = quat._x;
    const y = quat._y;
    const z = quat._z;
    const w = quat._w;

    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;

    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;

    const out = this.localTransform.elements;

    const pixelSize = this._pixelSize;
    const sx = this.scale._x * (this._texture.orig.width * pixelSize);
    const sy = this.scale._y * (this._texture.orig.height * pixelSize);
    const sz = this.scale._z;

    out[0] = (1 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[4] = (xy - wz) * sy;
    out[5] = (1 - (xx + zz)) * sy;
    out[6] = (yz + wx) * sy;
    out[8] = (xz + wy) * sz;
    out[9] = (yz - wx) * sz;
    out[10] = (1 - (xx + yy)) * sz;

    const dx = 0.5 - this._anchor._x;
    const dy = this._anchor._y - 0.5;

    out[12] = this.position._x + dx * out[0] + dy * out[4];
    out[13] = this.position._y + dx * out[1] + dy * out[5];
    out[14] = this.position._z + dx * out[2] + dy * out[6];

    if (this._origin !== null) this._addOriginOffset();
  }

  /**
   * Reads `quaternion` and `scale` rather than the matrix, whose basis carries a size that can be 0
   * @param out - Receives the offset.
   */
  protected override _getOriginOffset(out: Vector3): Vector3 {
    const origin = this._origin!;

    const ox = origin._x;
    const oy = origin._y;
    const oz = origin._z;
    const vx = ox * this.scale._x;
    const vy = oy * this.scale._y;
    const vz = oz * this.scale._z;

    const quat = this.quaternion;
    const x = quat._x;
    const y = quat._y;
    const z = quat._z;
    const w = quat._w;

    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;

    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;

    out.x = ox - ((1 - (yy + zz)) * vx + (xy - wz) * vy + (xz + wy) * vz);
    out.y = oy - ((xy + wz) * vx + (1 - (xx + zz)) * vy + (yz - wx) * vz);
    out.z = oz - ((xz - wy) * vx + (yz + wx) * vy + (1 - (xx + yy)) * vz);

    return out;
  }

  /**
   * Destroys the sprite; the shared quad geometry always survives, even `destroy(true)`
   *
   * A material the sprite made is always destroyed; one you gave it stays unless you pass
   * `material`. `texture` frees the sprite's texture, as on pixi's 2D `Sprite`, and
   * `textureSource` its source too; `textureSource` alone frees nothing. Children get your options
   * unchanged.
   * @example
   * ```ts
   * sprite.destroy({ texture: true, textureSource: true });
   * ```
   * @param options - Teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    const texture = this._texture;
    const material = this.material;
    const materialWasLive = !material.destroyed;
    if (texture.dynamic) texture.off('update', this._onTextureUpdate);

    super.destroy(options);

    const cascadeFreedMaterial = materialWasLive && material.destroyed;
    if (!cascadeFreedMaterial) {
      if (this._ownsMaterial && materialWasLive) {
        material.destroy(options);
      } else if (resolveDestroy3DFlag(options, 'texture')) {
        texture.destroy(resolveDestroy3DFlag(options, 'textureSource'));
      }
    }

    this._texture = null!;
  }

  /** Spares the quad every sprite shares, while children still get the caller's `geometry` flag */
  protected override _destroyGeometry(): void {}
}
