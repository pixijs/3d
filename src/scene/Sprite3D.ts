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

/** Warns, once, that a size in world units was dropped because the texture has no pixel size to divide by */
function warnUnsizedTexture(): void {
  warnOnce(
    'pixi3d-sprite3d-size-unloaded',
    '[pixi-3d] A Sprite3D was sized in world units while its texture had no dimensions (still ' +
      'loading?). The write was dropped — size the sprite after the texture resolves, or set ' +
      '`scale` directly.',
  );
}

/**
 * Options both {@link Sprite3D} constructor forms take: the node's own, which never touch the
 * material
 *
 * The {@link Mesh3DOptions} apply too (label, position, parent, eventMode, ...), except what the
 * sprite builds itself: the quad `geometry`, plus the `skeleton` and `weights` a flat quad has no
 * use for. `material` belongs to {@link Sprite3DMaterialOptions}. `label` defaults to
 * `'Sprite3D'`.
 * @example
 * ```ts
 * const marker = new Sprite3D({ texture, label: 'marker', eventMode: 'static', parent: view.root });
 * ```
 * @see {@link Sprite3DTextureOptions} For the self-contained form.
 * @see {@link Sprite3DMaterialOptions} For the shared-material form.
 * @category scene
 * @standard
 */
export interface Sprite3DSharedOptions extends Omit<Mesh3DOptions, 'geometry' | 'material' | 'skeleton' | 'weights'> {
  /**
   * How the quad turns to face the camera; see {@link BillboardMode}
   *
   * It picks the shader, so sprites with different modes don't share a draw. The {@link Sprite3D}
   * class notes say when that costs draw calls.
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
   * the origin. Left out, the texture's `defaultAnchor` applies, as on pixi's 2D `Sprite`. Without
   * one it's centred, unlike the 2D `Sprite`'s `(0, 0)`, because a billboard turns around its
   * centre. It's exact in `'none'` mode, and for `y` in `'cylindrical'` mode; the {@link Sprite3D}
   * class notes cover `'spherical'`.
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
   * {@link Sprite3DSharedOptions.pixelSize | pixelSize} on this axis
   *
   * Pass only `width` or only `height` and the other follows the texture's aspect ratio:
   * `{ height: 4 }` on a 128×200 texture gives 2.56 × 4. Pass both to stretch the image to that
   * box. Like pixi's 2D `Sprite`, it ends up in `scale`. Unlike it, a lone `width` or `height`
   * keeps the aspect ratio; the {@link Sprite3D#width} and {@link Sprite3D#height} accessors set
   * one axis each, as pixi's do.
   *
   * It's measured against the texture once, at construction. A texture still loading has no size
   * to fit against, so the value is dropped with a warning; size the sprite once it loads.
   * @example
   * ```ts
   * const sign = new Sprite3D({ texture: signTexture, width: 2 });
   * ```
   */
  width?: number;
  /**
   * The sprite's height in world units, in place of
   * {@link Sprite3DSharedOptions.pixelSize | pixelSize} on this axis; see
   * {@link Sprite3DSharedOptions.width} for how it combines with `width`
   * @example
   * ```ts
   * const tree = new Sprite3D({ texture: treeTexture, height: 4 });
   * ```
   */
  height?: number;
  /**
   * Whether the sprite casts shadows
   *
   * Off by default for a reason: the shadow pass doesn't turn meshes to face the camera, so a
   * billboarded sprite would cast the shadow of its unturned quad, an edge-on sliver that follows
   * the light rather than the camera. It's safe for quads in `'none'` mode.
   * @default false
   * @example
   * ```ts
   * const sign = new Sprite3D({ texture: signTexture, billboardMode: 'none', castShadow: true });
   * ```
   */
  castShadow?: boolean;
  /**
   * Whether the sprite is shadowed
   *
   * It does nothing with the default unlit material, which has no lighting to shadow, and it's
   * what you want with a lit one.
   * @default true
   * @example
   * ```ts
   * const card = new Sprite3D({ material: litLeaves, receiveShadow: false });
   * ```
   */
  receiveShadow?: boolean;
}

/**
 * The self-contained {@link Sprite3D} constructor form: the sprite makes an unlit
 * {@link FlatMaterial} of its own from these options, and {@link Sprite3D#destroy} frees it
 *
 * The material it makes is double-sided, since a billboard can turn either face to the camera.
 * `material` isn't allowed here: passing one is the other form, {@link Sprite3DMaterialOptions}.
 * The two don't mix, because these options shape a material and a material you pass has its own
 * values.
 * @example
 * ```ts
 * const tree = new Sprite3D({
 *   texture: treeTexture,
 *   billboardMode: 'cylindrical',
 *   anchor: { x: 0.5, y: 1 },   // stand it on the ground
 *   alphaMode: 'mask',
 * });
 * ```
 * @see {@link Sprite3D} For the constructed scene node.
 * @category scene
 * @standard
 */
export interface Sprite3DTextureOptions extends Sprite3DSharedOptions {
  /**
   * The image on the quad
   *
   * Its untrimmed pixel size times {@link Sprite3DSharedOptions.pixelSize | pixelSize} sets the
   * sprite's world size.
   * @default Texture.WHITE
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
   * {@link Sprite3DTextureOptions.alphaCutoff | alphaCutoff} in the opaque pass, with depth writes
   * and no sorting. That's the fastest on mobile and the usual pick for foliage. `'opaque'` draws
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
   * Not available in this form; see {@link Sprite3DMaterialOptions}
   * @hidden
   */
  material?: never;
}

/**
 * The shared-material {@link Sprite3D} constructor form: the material is in charge, and the
 * sprite writes nothing into it
 *
 * That makes one material safe to share between many sprites, which keeps the material count
 * down when there are lots of them. A lit material such as {@link Material3D} makes a lit
 * billboard, so a flat stand-in matches the lighting of the model it replaces: the turning comes
 * from {@link Sprite3D#billboardMode}, not the material.
 *
 * The material needs a `baseColor` texture slot, since the sprite reads its image, and so its
 * size, from there. `texture`, `tint`, `alpha`, `alphaMode` and `alphaCutoff` aren't allowed; set
 * them on the material, where they live. `doubleSided` is the material's choice too.
 * @example
 * ```ts
 * // One material, many sprites; nothing is written into it.
 * const leaves = new Material3D({ baseColorTexture: leafTexture, alphaMode: 'mask' });
 * for (const p of points) {
 *   const card = new Sprite3D({ material: leaves, billboardMode: 'cylindrical' });
 *   card.position.copyFrom(p);
 * }
 * ```
 * @see {@link Sprite3D} For the constructed scene node.
 * @category scene
 * @standard
 */
export interface Sprite3DMaterialOptions extends Sprite3DSharedOptions {
  /**
   * The material to draw the quad with; it must have a `baseColor` texture slot
   * @example
   * ```ts
   * const card = new Sprite3D({ material: leaves, billboardMode: 'cylindrical' });
   * ```
   */
  material: BaseMaterial3D;
  /**
   * Not available in this form; the material's `baseColor` texture is the image
   * @hidden
   */
  texture?: never;
  /**
   * Not available in this form; set `baseColor` on the material
   * @hidden
   */
  tint?: never;
  /**
   * Not available in this form; set `alpha` on the material
   * @hidden
   */
  alpha?: never;
  /**
   * Not available in this form; set `alphaMode` on the material
   * @hidden
   */
  alphaMode?: never;
  /**
   * Not available in this form; set `alphaCutoff` on the material
   * @hidden
   */
  alphaCutoff?: never;
}

/**
 * Constructor options for {@link Sprite3D}: one form or the other, never a mix
 *
 * The `?: never` members of each form keep the two apart, even for option objects built ahead of
 * time. The constructor takes each form through its own overload, so narrow a value of this union
 * before passing it, such as by checking `options.material`.
 * @example
 * ```ts
 * function makeSprite(options: Sprite3DOptions): Sprite3D {
 *   return options.material ? new Sprite3D(options) : new Sprite3D(options);
 * }
 * ```
 * @see {@link Sprite3DTextureOptions} For the self-contained form.
 * @see {@link Sprite3DMaterialOptions} For the shared-material form.
 * @category scene
 * @standard
 */
export type Sprite3DOptions = Sprite3DTextureOptions | Sprite3DMaterialOptions;

/**
 * A textured quad in the 3D scene, sized from its texture and, by default, turned to face the
 * camera by the vertex shader
 *
 * Give it a texture and it's `texture pixels × pixelSize` world units across. The rest is the
 * familiar sprite API: `anchor`, `tint`, `alpha`, `width` and `height`, plus `alphaMode` for
 * cutouts.
 *
 * It draws with an unlit {@link FlatMaterial} unless you give it another material. The turning
 * comes from {@link Mesh3D#billboardMode}, not the material, so a {@link Material3D} gives you a
 * **lit** billboard, which a flat stand-in needs to match the lighting of the model it replaces.
 *
 * ## Batching
 *
 * Every sprite draws the same shared quad, and draws batch by shader and geometry, not by
 * material. So any number of sprites that share a billboard mode and blending become **one
 * instanced draw**, with up to ten texture sources per draw. Switching to another frame of the
 * same sprite sheet uploads one 256-byte material row and keeps the batch as it is, so sprite
 * sheet animation costs almost nothing.
 *
 * A sprite that doesn't move costs no CPU time per frame: the vertex shader turns it.
 *
 * What limits the count is the scene node: the transform update, the transparent pass's sort and
 * the batcher's bookkeeping. Hundreds to a few thousand sprites is what it's built for. For tens of
 * thousands that you set and forget, fill {@link BatchedMesh3D} slots instead: give each one
 * {@link PlaneGeometry.spriteQuad}, a matrix whose X and Y scale carry the texture's world size,
 * and a `billboardMode`.
 *
 * ### Keep one billboard mode per blended effect
 *
 * {@link Sprite3DSharedOptions.billboardMode | billboardMode} picks the shader, so sprites with
 * different modes can't share a draw. In the opaque pass (`'mask'` and `'opaque'`) that costs one
 * draw per mode, however many sprites there are, because the pass groups by shader. With
 * `'blend'` it costs more: the transparent pass sorts back to front, so mixed modes interleave,
 * and every change of mode along that order starts a new draw.
 *
 * So give each family of blended sprites one mode: spherical for glows and flashes, cylindrical
 * for rising smoke. Texture, tint, alpha, size and position are all free to vary, since they live
 * in the material row or the transform and never split a draw.
 *
 * ## Origin
 *
 * `origin` is in world size units, as pixels are on a 2D sprite: texture pixels × `pixelSize`,
 * before `scale`. A 200×400 px texture at the default `pixelSize` is 2 × 4 units, so with the
 * centred anchor `origin = { x: 1, y: 2, z: 0 }` turns the sprite around its top-right corner. It
 * applies after `anchor`, which stays a fraction of the image. Children and `toLocal` still work
 * in quad units, where the image spans -0.5 to 0.5.
 *
 * ## Anchor, per mode
 *
 * - `'none'`: exact, as on a 2D sprite.
 * - `'cylindrical'`: `anchor.y` is exact, which is the case that matters: a tree anchored at its
 *   feet turns around its base from every angle. `anchor.x` swings around the spin axis.
 * - `'spherical'`: the offset is applied in the node's space, so an off-centre anchor drifts as
 *   the camera orbits. The centred default is exact.
 *
 * `origin` uses the node's own rotation the same way, so under a billboard mode it acts like an
 * off-centre anchor: `'cylindrical'` keeps its vertical part exact, and `'spherical'` drifts as
 * the camera orbits.
 *
 * ## Limitations
 *
 * - Children inherit the texture size, since it's part of the sprite's local matrix. Treat a
 *   sprite as a leaf node.
 * - {@link Container3D#reparentChild | reparentChild} splits the world matrix back into
 *   `position`, `quaternion` and `scale`, which would fold the texture size and anchor into them
 *   and apply them twice. Reparenting a sprite while keeping its world transform isn't supported;
 *   plain `addChild` and `removeChild` are fine.
 * - A `ContainerTexture` draws upside down on a sprite: it's flipped for the other 3D primitives,
 *   whose V axis runs up the image, and the sprite quad's runs down.
 * - A normal map on a sprite needs its **green channel pointing down** the image, the opposite of
 *   a mesh whose V runs up. The cause is the same: the quad's V runs down the image so images come
 *   out upright, and the tangent frame, built from screen-space derivatives, follows V. With green
 *   the other way round, a lit sprite looks lit from below.
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
 * @see {@link Mesh3D} For the scene-graph base class.
 * @see {@link Sprite3D#updateLocalTransform} For how size and anchor reach the matrix.
 * @category scene
 * @standard
 */
export class Sprite3D extends Mesh3D {
  /**
   * Default options merged under every constructor call
   *
   * `new Sprite3D(opts)` resolves as `{ ...Sprite3D.defaultOptions, ...opts }`, ignoring options
   * set to `undefined`. Mutate to change the defaults process-wide. The material options apply
   * only to the self-contained form; a material you pass keeps its own values.
   * @example
   * ```ts
   * // Author against a 32px-per-unit tile set:
   * Sprite3D.defaultOptions.pixelSize = 1 / 32;
   * ```
   */
  public static defaultOptions: Pick<
    Required<Sprite3DTextureOptions>,
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
   * The 3D counterpart of pixi's `Sprite.from`. An alias the cache doesn't have gives
   * `Texture.EMPTY`, and pixi warns, so the sprite draws nothing; load the asset first. That
   * matches 2D `Sprite.from`, where a typo draws nothing rather than the white quad
   * `new Sprite3D()` gives.
   * @example
   * ```ts
   * await Assets.load('tree.png');
   * const tree = Sprite3D.from('tree.png');
   * ```
   * @param source - The texture, or the source to build one from.
   * @param skipCache - Build a fresh texture instead of reusing a cached one for `source`.
   * @returns A sprite drawing that texture on its own {@link FlatMaterial}.
   */
  public static from(source: Texture | TextureSourceLike, skipCache = false): Sprite3D {
    if (source instanceof Texture) return new Sprite3D(source);

    return new Sprite3D(Texture.from(source, skipCache) ?? Texture.EMPTY);
  }

  private _texture: Texture;
  private _pixelSize = 0;
  /**
   * Observed on its own rather than alongside `position`, `scale` and `quaternion`, since the
   * anchor isn't a transform component; any change re-runs the transform update, as on 2D `Sprite`
   */
  private readonly _anchor: ObservablePoint;
  /**
   * Whether the sprite made its material rather than being given it, which decides whether
   * {@link Sprite3D#destroy} frees it unasked: a material it was given may be shared
   */
  private readonly _ownsMaterial: boolean;

  /**
   * Re-sizes the sprite when its texture changes shape in place: a frame edited, or a source that
   * resized once its image loaded
   *
   * It derives the UV frame again too, since no texture slot write happened to do it. Bound per
   * instance so it can be added to and removed from whichever texture the sprite holds.
   *
   * Only {@link Texture.dynamic} textures get it, as on pixi's 2D `Sprite`. A listener on every
   * texture would cost every sprite one, and adding and removing it on each swap would make frame
   * animation expensive. A change to a texture that isn't dynamic goes unseen.
   */
  private readonly _onTextureUpdate = (): void => {
    this.material._deriveUvFrame();
    this._onUpdate();
  };

  /**
   * Creates a self-contained `Sprite3D`, which makes an unlit {@link FlatMaterial} of its own from
   * the options and owns it; add it under {@link View3D.root | view.root} to draw it
   *
   * A bare `Texture` is short for `{ texture }`, as with pixi's 2D `Sprite`.
   * @example
   * ```ts
   * const glow = new Sprite3D(glowTexture);
   * ```
   * @param options - Construction options, or the texture to draw; see {@link Sprite3DTextureOptions}.
   */
  constructor(options?: Sprite3DTextureOptions | Texture);
  /**
   * Creates a `Sprite3D` on a material you give it
   *
   * The material is in charge: the sprite reads its image, and so its size, from the `baseColor`
   * slot and writes nothing, so the material is safe to share between sprites. Throws when the
   * material has no `baseColor` slot. Given material options as well, which plain JavaScript
   * allows, the sprite keeps the material, ignores the options and warns once.
   * @param options - Construction options; see {@link Sprite3DMaterialOptions}.
   */
  constructor(options: Sprite3DMaterialOptions);
  constructor(options: Sprite3DOptions | Texture = {}) {
    if (options instanceof Texture) options = { texture: options };

    const explicit = definedProps(options);
    /**
     * The sprite's own options, pulled out so the base constructor never assigns them
     *
     * `width`, `height` and `parent` wait until the sprite is built: sizing measures the texture,
     * and attaching to a view must see a finished sprite.
     */
    const {
      material: supplied,
      texture: textureOption,
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

    if (
      supplied &&
      (explicit.texture !== undefined ||
        explicit.tint !== undefined ||
        explicit.alpha !== undefined ||
        explicit.alphaMode !== undefined ||
        explicit.alphaCutoff !== undefined)
    ) {
      warnOnce(
        'pixi3d-sprite3d-two-forms',
        '[pixi-3d] Sprite3D was given `material` alongside material-shaping options (texture / ' +
          'tint / alpha / alphaMode / alphaCutoff). The two constructor forms are exclusive; the ' +
          'material is authoritative and the extras were ignored — set them on the material itself.',
      );
    }

    /** The image to size from: a supplied material's `baseColor`, which the sprite measures but doesn't own */
    const texture = supplied ? (supplied.textures.baseColor ?? Texture.WHITE) : (textureOption ?? Texture.WHITE);

    super({
      label: 'Sprite3D',
      ...rest,
      geometry: PlaneGeometry.spriteQuad,
      material:
        supplied ??
        new FlatMaterial({
          baseColorTexture: texture,
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

    if (supplied) this.updateShadow();

    this._pixelSize = pixelSize;
    this._texture = texture;
    if (texture.dynamic) texture.on('update', this._onTextureUpdate);

    this._anchor = new ObservablePoint({ _onUpdate: () => this._onUpdate() }, 0.5, 0.5);
    const initialAnchor = anchor ?? texture.defaultAnchor;
    if (initialAnchor !== undefined) this.anchor = initialAnchor;

    if (width !== undefined || height !== undefined) this._fitSize(width, height);
    parent?.addChild(this);
  }

  /**
   * Resolves the construction `width` and `height` onto `scale`
   *
   * A missing axis follows the texture's pixel aspect ratio, from `orig` so a sprite sheet frame
   * fits its own frame rather than the whole sheet. Both axes then get the same scale factor and
   * the image isn't distorted.
   * @param width - Target width in world units, or `undefined` to derive it from `height`.
   * @param height - Target height in world units, or `undefined` to derive it from `width`.
   */
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
   * Assigning another sizes the sprite from it. Switching to another frame of the **same** source,
   * as sprite sheet animation does, only uploads the material row and keeps the batch as it is. A
   * frame from another source moves the sprite to another batch but reuses compiled shaders.
   *
   * The image lives in the material's `baseColor` slot, so assigning writes there. That's safe on
   * a material the sprite made. On a material you gave it and share, it changes every sprite using
   * it, so animate frames only on sprites with their own material.
   *
   * To change a texture's frame in place later, mark it `dynamic` before handing it over: like
   * pixi's 2D `Sprite`, a sprite only follows changes to dynamic textures.
   * @example
   * ```ts
   * coin.texture = sheet.textures[`coin_${frame}.png`];
   * ```
   */
  get texture(): Texture {
    return this._texture;
  }

  /**
   * Swaps the image and re-sizes the sprite; the material's texture slot derives the UV frame,
   * rotated frames included, and moves the sprite to another batch for a new source
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
   * single number for both axes, or change it in place. The
   * {@link Sprite3DSharedOptions.anchor | anchor} option covers how it behaves in each billboard
   * mode.
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
   * @param value - Colour to multiply by; writes through to the material's `baseColor`.
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
   * @param value - Opacity from 0 to 1; writes through to the material.
   */
  set alpha(value: number) {
    this.material.alpha = value;
  }

  /**
   * How the texture's alpha is used: `'blend'` sorts the sprite with the transparent pass, `'mask'`
   * cuts it out in the opaque pass, and `'opaque'` draws the quad solid
   *
   * A change moves the sprite between passes on the next frame. It writes the material, so on a
   * shared material it moves every sprite using it, but only this sprite checks again whether it
   * casts shadows. Shadow-casting sprites that share the material need their own
   * {@link Mesh3D#updateShadow} call.
   * @example
   * ```ts
   * leaf.alphaMode = 'mask';
   * ```
   */
  get alphaMode(): AlphaMode {
    return this.material.alphaMode;
  }

  /**
   * Moves the sprite between passes and checks its shadow casting again, which the material can't
   * do since it doesn't know its meshes
   * @param value - How alpha is used; changes every sprite sharing the material.
   */
  set alphaMode(value: AlphaMode) {
    if (this.material.alphaMode === value) return;
    this.material.alphaMode = value;
    this.updateShadow();
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
   * @param value - Alpha below which `'mask'` mode discards a fragment, 0 to 1.
   */
  set alphaCutoff(value: number) {
    this.material.alphaCutoff = value;
  }

  /**
   * The sprite's width in world units: `|scale.x| × texture width × pixelSize`
   *
   * Assigning writes `scale.x`, so `scale` holds only your own values and the texture size stays
   * out of it. It sets one axis, as on pixi's 2D `Sprite`, and leaves {@link Sprite3D#height}
   * alone; to keep the aspect ratio, pass {@link Sprite3DSharedOptions.width | width} at
   * construction.
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

  /**
   * Scale on one axis that makes it `size` world units wide, keeping the axis's sign
   * @param size - Target extent in world units
   * @param pixels - Texture extent on that axis
   * @param currentScale - Current scale on the axis, for its sign
   * @returns The new scale, or `null` (after a warning) when the texture has no size yet
   */
  private _scaleForWorldSize(size: number, pixels: number, currentScale: number): number | null {
    if (pixels === 0) {
      warnUnsizedTexture();

      return null;
    }

    return (size / (pixels * this._pixelSize)) * (Math.sign(currentScale) || 1);
  }

  /**
   * Rebuilds {@link Container3D.localTransform | localTransform} with the texture's world size and
   * the anchor offset already in it
   *
   * The size scales the X and Y axes. It comes from the texture's untrimmed frame, `orig`, so a
   * sprite sheet sprite measures its own frame, and a texture with no size yet shrinks the quad to
   * a point. The anchor offset is a fraction of those scaled axes, so it stays a fraction of the
   * sprite and follows the node's rotation.
   *
   * It writes every element itself rather than calling the base method and scaling afterwards:
   * folding the size in costs two multiplies, where a second pass would read and write six
   * elements again, and this runs for every sprite on every transform update. Each call rebuilds
   * the matrix from the components alone, so the size never compounds. It reads and writes the
   * components' fields directly, skipping their change notifications and getters, since it is the
   * update those notifications would queue.
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
   * The base class's offset, with the origin in world size units: texture pixels × `pixelSize`,
   * before `scale`, as pixels are on a 2D sprite
   *
   * The local matrix carries the texture size, so the basis is rebuilt from `quaternion` and
   * `scale` alone rather than read back, which would divide by a size that can be 0. Call it once
   * {@link Sprite3D#updateLocalTransform} has synced the quaternion.
   * @param out - Receives the offset
   * @returns `out`
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
   * A {@link FlatMaterial} the sprite made for itself is always destroyed: nothing else can hold
   * it, so keeping it would leak. A material you gave it follows {@link Destroy3DOptions} instead
   * and stays unless you pass `material`, since you may be sharing it between sprites.
   *
   * `texture` frees the sprite's texture, as on pixi's 2D `Sprite`: through the material when this
   * call destroys it, and directly otherwise, so a material destroyed earlier doesn't leave the
   * texture behind. `textureSource` extends that to the texture's source and frees nothing on its
   * own.
   *
   * Children destroyed under `children` get your options unchanged, so a child mesh's geometry
   * follows `geometry` as it would anywhere else.
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

    /**
     * Whether the base destroy just destroyed the material, which already freed the textures the
     * caller asked for, so they aren't destroyed twice
     *
     * A material destroyed before this call freed nothing now, so then the texture is freed here.
     */
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

  /**
   * Does nothing: the quad is shared by every sprite, so no `geometry` flag may free it
   *
   * Sparing the quad here, rather than changing the flags, is what lets the caller's options reach
   * the sprite's children unchanged.
   */
  protected override _destroyGeometry(): void {}
}
