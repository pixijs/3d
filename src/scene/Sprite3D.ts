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

/** Every world-unit size path needs the texture's pixel dimensions; without them there is nothing to divide by */
function warnUnsizedTexture(): void {
  warnOnce(
    'pixi3d-sprite3d-size-unloaded',
    '[pixi-3d] A Sprite3D was sized in world units while its texture had no dimensions (still ' +
      'loading?). The write was dropped — size the sprite after the texture resolves, or set ' +
      '`scale` directly.',
  );
}

/**
 * Options shared by both {@link Sprite3D} constructor forms — node-level state
 * that never touches the material
 *
 * Everything {@link Mesh3DOptions} takes carries over (label, position, parent,
 * eventMode, ...) except what the sprite builds itself: the quad `geometry`, and
 * the `skeleton` / `weights` a flat quad has no use for. `material` belongs to
 * {@link Sprite3DMaterialOptions}. `label` defaults to `'Sprite3D'`.
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
   * How the quad orients itself — see {@link BillboardMode}. Reassignable at
   * runtime via {@link Sprite3D#billboardMode}.
   *
   * It selects a shader variant, which makes it a batch boundary; see the
   * {@link Sprite3D} class docs for why that matters for `'blend'` sprites and
   * not for `'mask'`.
   * @default 'spherical'
   */
  billboardMode?: BillboardMode;
  /**
   * Which point of the image sits on the node's origin, as a fraction of its
   * size (`y` measured from the image's top edge). A single number sets both
   * axes. `(0.5, 0.5)` centres the sprite; `y = 1` stands it on the origin.
   *
   * When omitted, the texture's `defaultAnchor` applies if it has one, as on
   * 2D `Sprite`. Otherwise the fallback is centred, deliberately different from
   * 2D `Sprite`'s `(0, 0)` because centred is what a billboard wants. Exact in
   * `'none'` and (for `y`) `'cylindrical'` mode; see the {@link Sprite3D} class
   * docs for the `'spherical'` caveat.
   * @default 0.5
   */
  anchor?: PointData | number;
  /**
   * World units per texture pixel — the sprite's size multiplier. At the
   * default 0.01 a 512px texture is 5.12 units across, which sits sensibly in
   * a metres-scale scene.
   * @default 0.01
   */
  pixelSize?: number;
  /**
   * The sprite's width in world units, overriding
   * {@link Sprite3DSharedOptions.pixelSize | pixelSize} for this axis.
   *
   * Pass one of `width` / `height` and the other follows the texture's aspect
   * ratio — `{ height: 4 }` on a 128×200 texture gives 2.56 × 4. Pass both to
   * stretch to exactly that box. Pass neither and the texture's own pixel size
   * times `pixelSize` decides.
   *
   * Like pixi's 2D `Sprite`, this resolves to a `scale` write; unlike it, a lone
   * `width` or `height` fits the other axis rather than squashing. That's a
   * construction-time convenience only — the {@link Sprite3D#width} /
   * {@link Sprite3D#height} accessors each write one axis, as pixi's do.
   *
   * Resolved once, against the sprite's image at construction. A texture that
   * is still loading has no dimensions to fit against, so the write is dropped
   * with a warning — size the sprite after it resolves.
   */
  width?: number;
  /**
   * The sprite's height in world units, overriding
   * {@link Sprite3DSharedOptions.pixelSize | pixelSize} for this axis. See
   * {@link Sprite3DSharedOptions.width} for how the two combine.
   */
  height?: number;
  /**
   * Whether the sprite casts shadows
   *
   * Off by default, and not idly: the shadow pass doesn't compose material
   * shader bits, so a billboarded caster would be shadowed from its raw
   * geometry — an edge-on sliver that follows the light, not the camera. Safe
   * to turn on for `'none'`-mode quads.
   * @default false
   */
  castShadow?: boolean;
  /**
   * Whether the sprite samples the shadow map. Inert on an unlit material — an
   * unlit shader has no light loop to shadow — so it costs nothing until a lit
   * material is involved, at which point it is what you want.
   * @default true
   */
  receiveShadow?: boolean;
}

/**
 * The self-contained {@link Sprite3D} constructor form: the sprite mints an
 * unlit {@link FlatMaterial} of its own, shaped by these options, and
 * {@link Sprite3D#destroy} frees it. The classic sprite path.
 *
 * `material` is excluded — supplying one is the other form
 * ({@link Sprite3DMaterialOptions}), and the two don't mix: these options
 * shape a material, and a supplied material already carries its own values.
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
   * The image drawn on the quad. Its untrimmed pixel dimensions, multiplied by
   * {@link Sprite3DSharedOptions.pixelSize | pixelSize}, set the sprite's
   * world size.
   * @default Texture.WHITE
   */
  texture?: Texture;
  /**
   * Colour multiplied into the texture, `Container.tint` semantics — set any
   * `ColorSource`, read back the canonical hex.
   * @default 0xffffff
   */
  tint?: ColorSource;
  /**
   * Opacity multiplied into the texture's alpha
   * @default 1
   */
  alpha?: number;
  /**
   * How alpha is resolved
   *
   * `'blend'` routes the sprite into the transparent pass, which already
   * distance-sorts back-to-front every frame — the right default for
   * soft-edged images. Switch to `'mask'` for cutouts
   * (opaque pass, depth writes, no sorting — the mobile fast path, and the
   * standard choice for foliage) or `'opaque'` for fully solid quads.
   * @default 'blend'
   */
  alphaMode?: AlphaMode;
  /**
   * Alpha threshold below which fragments are discarded in `'mask'` mode
   * @default 0.5
   */
  alphaCutoff?: number;
  /** Excluded from this form; see {@link Sprite3DMaterialOptions} */
  material?: never;
}

/**
 * The shared-material {@link Sprite3D} constructor form: the material is
 * authoritative and the sprite writes **nothing** into it, which is what makes
 * one material safe to share across many sprites — the way to keep the
 * material count down at high sprite counts. A lit material (e.g.
 * {@link Material3D}) makes the sprite a **lit** billboard, how impostor cards
 * match the lighting of the geometry they stand in for: billboarding is
 * injected by the core from {@link Sprite3D#billboardMode} and composes with
 * any material.
 *
 * The material must expose a `baseColor` texture slot — that slot is where the
 * sprite reads its image, and so its size, from. The material-shaping options
 * (`texture`, `tint`, `alpha`, `alphaMode`, `alphaCutoff`) are excluded: set
 * those on the material itself, where they already live. `doubleSided` is
 * likewise the material's own call.
 * @example
 * ```ts
 * // One material, many sprites — nothing is written into it.
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
  /** The material to shade the quad with; must carry a `baseColor` slot */
  material: BaseMaterial3D;
  /** Excluded from this form — the material's `baseColor` slot is authoritative */
  texture?: never;
  /** Excluded from this form — set `baseColor` on the material */
  tint?: never;
  /** Excluded from this form — set `alpha` on the material */
  alpha?: never;
  /** Excluded from this form — set `alphaMode` on the material */
  alphaMode?: never;
  /** Excluded from this form — set `alphaCutoff` on the material */
  alphaCutoff?: never;
}

/**
 * Constructor options for {@link Sprite3D} — one form or the other, never a
 * mix. The `?: never` markers on each form are what keep the exclusivity
 * airtight for pre-built (non-literal) option objects too.
 *
 * The constructor takes each form through its own overload, so a value typed
 * as this union needs narrowing first — `'material' in options` — before
 * constructing from it.
 * @see {@link Sprite3DTextureOptions} For the self-contained form.
 * @see {@link Sprite3DMaterialOptions} For the shared-material form.
 * @category scene
 * @standard
 */
export type Sprite3DOptions = Sprite3DTextureOptions | Sprite3DMaterialOptions;

/**
 * A textured quad in the 3D scene, sized from its texture and — by default —
 * turned to face the camera every frame by the vertex shader.
 *
 * Give it a texture and it renders at `texture pixels × pixelSize` world
 * units. Everything else is the familiar sprite surface: `anchor`, `tint`,
 * `alpha`, `width` / `height`, plus `alphaMode` for cutouts.
 *
 * It shades with an unlit {@link FlatMaterial} unless you hand it something
 * else. Billboarding isn't part of the material — the core injects it from
 * {@link Mesh3D#billboardMode}, the same route `skeleton` takes for skinning —
 * so pass a {@link Material3D} and you get a **lit** billboard, which is what
 * impostor cards need to match the lighting of the geometry they replace.
 *
 * ## Batching
 *
 * Every sprite draws the same shared quad geometry, and the batcher keys on
 * pipeline plus geometry — not on material instance. So any number of sprites
 * sharing a billboard mode and blend state collapse into **one instanced draw**,
 * with up to ten distinct texture sources packed per bind group. Swapping to
 * another frame of the same atlas is a 256-byte row upload, not a re-batch, so
 * spritesheet animation is close to free.
 *
 * A static sprite costs nothing per frame: orientation is ~12 vertex-shader ops
 * on four vertices and never touches the CPU.
 *
 * The scale ceiling is the scene-graph node itself — the transform walk, the
 * transparent-pass sort, the batcher item. Hundreds to low thousands of managed
 * sprites is the design point. For fire-and-forget counts in the tens of
 * thousands, drive {@link BatchedMesh3D} slots directly: give each slot
 * {@link PlaneGeometry.spriteQuad}, a matrix whose X/Y scale carries the texture's
 * world size, and a `billboardMode`.
 *
 * ### Keep one billboard mode per blended effect
 *
 * {@link Sprite3DSharedOptions.billboardMode | billboardMode} picks the shader variant,
 * so it is a batch boundary. That is free in the opaque pass (`'mask'` /
 * `'opaque'`), which groups by batch key — one draw per mode however many sprites
 * you have. It is **not** free for `'blend'`: the transparent pass sorts
 * back-to-front, so mixing modes interleaves them in draw order and every mode
 * change breaks the batch. Measured: 200 blended sprites go from 1 draw to 103
 * when their modes alternate.
 *
 * So pick one mode per family of blended sprites — spherical for glows and
 * flashes, cylindrical for upright smoke — rather than mixing modes within one.
 * Everything else is free to vary: texture, tint, alpha, size, and position all
 * live in the material row or the transform and never split a draw.
 *
 * ## Origin
 *
 * `origin` is in world size units, like pixels on a 2D sprite: texture pixels ×
 * `pixelSize`, before `scale`. A 200×400 px texture at the default `pixelSize`
 * is 2 × 4 units, so with the centred anchor `origin = { x: 1, y: 2, z: 0 }`
 * turns the sprite around its top-right corner. It applies after `anchor`,
 * which stays a fraction of the image. Children and `toLocal` still work in
 * quad units, where the image spans -0.5 to 0.5.
 *
 * ## Anchor, per mode
 *
 * - `'none'` — exact, same as a 2D sprite.
 * - `'cylindrical'` — `anchor.y` is exact, which is the headline case: a
 *   feet-anchored tree pivots around its base from every camera angle.
 *   `anchor.x` hinges around the spin axis.
 * - `'spherical'` — the offset is applied in node space, so an off-centre
 *   anchor drifts as the camera orbits. The centred default is exact.
 *
 * `origin` bakes in the node's own rotation the same way, so under a billboard
 * mode it acts like an off-centre anchor: `'cylindrical'` keeps its vertical
 * part exact, and `'spherical'` drifts as the camera orbits.
 *
 * ## Limitations
 *
 * - Children inherit the texture size, since it lives in the sprite's own
 *   local matrix. Treat a sprite as a leaf node.
 * - `Container3D.reparentChild` decomposes the world matrix back onto
 *   `position` / `quaternion` / `scale`, which would fold the texture size into
 *   `scale` and double-apply it. Keep-world reparenting is unsupported here;
 *   plain `addChild` / `removeChild` are fine.
 * - A `ContainerTexture` renders upside-down on a sprite: it pre-flips itself
 *   for the v-up 3D primitives, and the sprite quad is v-down.
 * - Normal maps on a sprite want their **green channel running down** the image
 *   (the Y-down convention), the opposite of a v-up mesh. Same root cause: the
 *   quad's V axis runs top-to-bottom in world space so images come out upright,
 *   and the derivative-built tangent frame follows V. Author green the other way
 *   round and a lit sprite shades from below.
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
 * // Later, in world units — each accessor writes one axis of `scale`:
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
   * Default options merged under every constructor call — `new Sprite3D(opts)`
   * resolves as `{ ...Sprite3D.defaultOptions, ...opts }`. Mutate to change
   * the defaults process-wide. The material-shaping members only apply to the
   * self-contained form; a supplied material always keeps its own values.
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
    // Inert on the default unlit material, and correct the moment a lit one is
    // supplied — so the safe default is on.
    receiveShadow: true,
  };

  /**
   * Creates a self-contained sprite from a texture, or from anything
   * `Texture.from` accepts (an asset alias or URL already in the cache, an
   * image, a canvas, a `TextureSource`)
   *
   * The 3D counterpart of pixi's `Sprite.from`. An alias the cache has never seen
   * yields an empty texture, so the sprite draws nothing until you load the asset
   * — where `new Sprite3D()` deliberately gives you a white quad instead.
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

    // `Texture.from` hands back the cache entry itself, which is `undefined` for an alias that was
    // never loaded. Falling back to `Texture.EMPTY` matches 2D `Sprite.from`: a typo renders
    // nothing rather than a white dot.
    return new Sprite3D(Texture.from(source, skipCache) ?? Texture.EMPTY);
  }

  private _texture: Texture;
  private _pixelSize: number;
  private readonly _anchor: ObservablePoint;
  /**
   * Whether the material was minted here rather than handed in. Decides whether
   * {@link Sprite3D#destroy} may free it unasked — a supplied one may be shared.
   */
  private readonly _ownsMaterial: boolean;

  /**
   * Re-enters the transform cascade when the texture changes shape under us —
   * a frame edited in place, or a source that resized once its image loaded.
   * The UV frame has to be re-derived by hand: no slot write happened, so the
   * material's own derivation hook never fired.
   *
   * Bound per instance so it can be handed to (and taken back off) whichever
   * texture the sprite currently holds.
   *
   * Only {@link Texture.dynamic} textures are subscribed, matching 2D `Sprite`.
   * A static texture never fires, so the listener would be dead weight on every
   * sprite, and the add/remove pair on each swap is what makes animated frames
   * expensive. Mutating a static texture is the caller's to announce.
   */
  private readonly _onTextureUpdate = (): void => {
    this.material._deriveUvFrame();
    this._onUpdate();
  };

  /**
   * Creates a self-contained `Sprite3D`: the sprite mints an unlit
   * {@link FlatMaterial} of its own from the options, and owns it. Parent it
   * under a {@link View3D}'s {@link View3D.root | root} (or any descendant) to
   * render it.
   *
   * A bare `Texture` is shorthand for `{ texture }`, as with pixi's 2D `Sprite`.
   * @example
   * ```ts
   * const glow = new Sprite3D(glowTexture);
   * ```
   * @param options - construction options, or the texture to draw; see {@link Sprite3DTextureOptions}.
   */
  constructor(options?: Sprite3DTextureOptions | Texture);
  /**
   * Creates a `Sprite3D` on a supplied material. The material is authoritative
   * — the sprite reads its image (and size) from the `baseColor` slot and
   * writes nothing, so the material is safe to share across sprites.
   * @param options - construction options; see {@link Sprite3DMaterialOptions}.
   */
  constructor(options: Sprite3DMaterialOptions);
  constructor(options: Sprite3DOptions | Texture = {}) {
    if (options instanceof Texture) options = { texture: options };

    const explicit = definedProps(options);
    // Own keys come out here. `width` / `height` / `parent` also wait until the
    // sprite is built: sizing measures the texture, and attaching to a live
    // `parent` must see a finished sprite.
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

    // The two forms are exclusive at the type level; a plain-JS mixed bag
    // degrades predictably — the material stays authoritative.
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

    // With a material in hand, its `baseColor` slot is the single source of
    // truth for the image — the sprite measures it rather than owning it.
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
          // One program for both faces: the billboard rebuild can hand the
          // rasteriser either winding, and culling is moot on a flat quad.
          doubleSided: true,
        }),
      castShadow,
      receiveShadow,
      // Core injects the billboard bit from this, so it composes with whatever
      // material ended up above.
      billboardMode,
    });

    this._ownsMaterial = supplied === undefined;

    // A supplied material's alphaMode drives pass routing, which gates the
    // shadow bit — re-evaluate it against this mesh's intent.
    if (supplied) this.updateShadow();

    this._pixelSize = pixelSize;
    this._texture = texture;
    // Frame edits and async source resizes both change the quad size and the
    // derived UV frame.
    if (texture.dynamic) texture.on('update', this._onTextureUpdate);

    // Anchor is not a transform component, so it gets its own observer rather
    // than joining `position` / `scale` / `quaternion` on `_onUpdate`'s
    // identity checks. Mirrors 2D `Sprite`, including the fall back to the
    // texture's own `defaultAnchor`.
    this._anchor = new ObservablePoint({ _onUpdate: () => this._onUpdate() }, 0.5, 0.5);
    const initialAnchor = anchor ?? texture.defaultAnchor;
    if (initialAnchor !== undefined) this.anchor = initialAnchor;

    if (width !== undefined || height !== undefined) this._fitSize(width, height);
    parent?.addChild(this);
  }

  /**
   * Resolve the construction `width` / `height` pair onto `scale`. A missing axis
   * is derived from the texture's own pixel aspect (`orig`, so a spritesheet
   * frame fits its frame rather than the whole atlas), which lands both axes on
   * the same scale factor and keeps the image undistorted.
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
   * The image drawn on the quad. Assigning re-sizes the sprite from the new
   * texture's dimensions and re-derives the UV frame.
   *
   * Swapping to another frame of the **same** source (spritesheet animation) is
   * a pure material-row upload — no re-key, no re-batch. A cross-source swap
   * re-keys the batch but still hits the compiled-shader cache.
   *
   * The image lives in the material's `baseColor` slot, so assigning writes
   * there. Safe on a material the sprite owns; on one you supplied and share
   * across sprites it repaints all of them — animate frames per-sprite only when
   * the sprite owns its material.
   */
  get texture(): Texture {
    return this._texture;
  }

  /**
   * Swaps the image, re-deriving the UV frame and re-sizing the sprite
   * @param value - Image to draw on the quad.
   */
  set texture(value: Texture) {
    if (this._texture === value) return;

    if (this._texture.dynamic) this._texture.off('update', this._onTextureUpdate);
    this._texture = value;
    if (value.dynamic) value.on('update', this._onTextureUpdate);

    // Owns the slot semantics: identity early-out, batch re-key on a
    // cross-source swap, and UV-frame derivation (GroupD8 rotation included).
    this.material.textures.baseColor = value;
    this._onUpdate();
  }

  /**
   * Which point of the image sits on the node's origin, as a fraction of its
   * size — `y` measured from the image's top edge. `(0.5, 0.5)` is centred,
   * `y = 1` stands the sprite on the origin.
   *
   * Assign a `PointData`, a single number for both axes, or mutate in place
   * (`sprite.anchor.y = 1`).
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
   * World units per texture pixel — the sprite's size multiplier. Changing it
   * re-sizes the sprite without touching `scale`.
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
   * Colour multiplied into the texture. `Container.tint` semantics: set any
   * `ColorSource`, read back the canonical hex. Opacity is {@link Sprite3D#alpha}.
   *
   * Writes through to the material's `baseColor` — on a shared material that
   * repaints every sprite using it.
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
   * Opacity multiplied into the texture's alpha. Writes through to the
   * material — on a shared material it fades every sprite using it.
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
   * How alpha is resolved — `'blend'` (transparent pass, distance-sorted),
   * `'mask'` (cutout in the opaque pass), or `'opaque'`. Switching re-routes the
   * sprite between passes on the next frame.
   *
   * Writes through to the material, re-routing every sprite that shares it —
   * but only this sprite re-evaluates its shadow bit here. Shadow-casting
   * siblings need their own {@link Mesh3D.updateShadow} call.
   */
  get alphaMode(): AlphaMode {
    return this.material.alphaMode;
  }

  /**
   * Re-routes the sprite between passes and re-evaluates the shadow bit
   * @param value - How alpha is resolved; changes every sprite sharing the material.
   */
  set alphaMode(value: AlphaMode) {
    if (this.material.alphaMode === value) return;
    this.material.alphaMode = value;
    // The material has no back-reference to its meshes, so the shadow bit has
    // to be re-evaluated from this side (blend never casts).
    this.updateShadow();
  }

  /** Alpha threshold below which fragments are discarded in `'mask'` mode. Writes through to the material */
  get alphaCutoff(): number {
    return this.material.alphaCutoff;
  }

  /**
   * Sets the discard threshold for 'mask' mode
   * @param value - Alpha below which `'mask'` mode discards a fragment, 0 to 1.
   */
  set alphaCutoff(value: number) {
    this.material.alphaCutoff = value;
  }

  /**
   * The sprite's width in world units — `|scale.x| × texture width × pixelSize`
   *
   * Assigning writes through to `scale.x`, so `scale` keeps holding pure user
   * values and the texture size stays out of it.
   *
   * One axis only, matching pixi's 2D `Sprite` — it does not adjust
   * {@link Sprite3D#height} to keep the aspect ratio. For that, pass
   * {@link Sprite3DSharedOptions.width | width} at construction.
   */
  public override get width(): number {
    return Math.abs(this.scale.x) * this._texture.orig.width * this._pixelSize;
  }

  /**
   * Writes through to `scale.x` from a world-unit width
   * @param value - Width in world units.
   */
  public override set width(value: number) {
    const scale = this._scaleForWorldSize(value, this._texture.orig.width, this.scale.x);
    if (scale !== null) this.scale.x = scale;
  }

  /**
   * The sprite's height in world units — `|scale.y| × texture height × pixelSize`
   *
   * Assigning writes through to `scale.y` only; see {@link Sprite3D#width}.
   */
  public override get height(): number {
    return Math.abs(this.scale.y) * this._texture.orig.height * this._pixelSize;
  }

  /**
   * Writes through to `scale.y` from a world-unit height
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
   * Rebuilds {@link Container3D.localTransform | localTransform} with the texture's
   * world size and anchor offset already in it.
   *
   * Deliberately does not call `super` and re-scale afterwards. The base builds the
   * basis columns by multiplying the rotation by `scale`, so the texture size is the
   * same multiply — folding it in costs two extra multiplies, where a second pass
   * costs re-reading and rewriting six elements the base just wrote. This runs per
   * sprite per transform update, which is the whole budget at high sprite counts.
   *
   * Every element is written fresh from `position` / `quaternion` / `scale`, so it
   * stays a pure function of the components: repeated calls are idempotent and the
   * size can never compound.
   */
  public override updateLocalTransform(): void {
    const quat = this.quaternion;

    if (this.rotationDirty) {
      this.rotationDirty = false;

      // Direct field access — we already own this update, observer fires would re-enqueue this node.
      const rx = this.rotation._x;
      const ry = this.rotation._y;
      const rz = this.rotation._z;

      const c1 = Math.cos(rx / 2);
      const c2 = Math.cos(ry / 2);
      const c3 = Math.cos(rz / 2);

      const s1 = Math.sin(rx / 2);
      const s2 = Math.sin(ry / 2);
      const s3 = Math.sin(rz / 2);

      // Direct write — batch all four components, skip the four observer dispatches the setters would fire.
      quat._x = s1 * c2 * c3 + c1 * s2 * s3;
      quat._y = c1 * s2 * c3 - s1 * c2 * s3;
      quat._z = c1 * c2 * s3 + s1 * s2 * c3;
      quat._w = c1 * c2 * c3 - s1 * s2 * s3;
    }

    // Direct field access — getter dispatch would inflate this hot path.
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

    // The texture's world size rides in on the basis scale. `orig` is the
    // untrimmed frame, so a spritesheet sprite measures its own frame; a texture
    // with no extent collapses the X/Y columns and leaves Z as authored.
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

    // Anchor rides the already-scaled basis, so the offset stays a unitless
    // fraction of the sprite and follows the node's rotation. Pixi's 2D
    // convention: the fraction of the image on the origin, `y` from the top edge.
    const dx = 0.5 - this._anchor._x;
    const dy = this._anchor._y - 0.5;

    out[12] = this.position._x + dx * out[0] + dy * out[4];
    out[13] = this.position._y + dx * out[1] + dy * out[5];
    out[14] = this.position._z + dx * out[2] + dy * out[6];

    if (this._origin !== null) this._addOriginOffset();
  }

  /**
   * The base offset, with the origin in world size units: texture pixels × `pixelSize`, before
   * `scale`, like pixels on a 2D sprite
   *
   * The local matrix carries the texture size, so the basis is rebuilt from `quaternion` and `scale`
   * alone rather than read back, which would divide by a size that can be 0. Call it once
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
   * Tears the sprite down. The shared quad geometry always survives, even
   * `destroy(true)`.
   *
   * A {@link FlatMaterial} the sprite built for itself is always destroyed —
   * nothing else can be holding it, so keeping it would leak. A material you
   * supplied follows the normal {@link Destroy3DOptions} contract instead and is
   * kept unless you pass `material`, since you may well be sharing it across
   * sprites.
   *
   * `texture` frees the sprite's texture, as on pixi's 2D `Sprite`: through the
   * material when this call destroys it, otherwise directly, so a material
   * destroyed earlier does not leave the texture behind. `textureSource` widens
   * that to the underlying source and frees nothing on its own.
   *
   * Children destroyed under `children` get the caller's own options, so a
   * child mesh's geometry follows `geometry` as it would anywhere else.
   * @example
   * ```ts
   * sprite.destroy({ texture: true, textureSource: true });
   * ```
   * @param options - teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    const texture = this._texture;
    const material = this.material;
    const materialWasLive = !material.destroyed;
    if (texture.dynamic) texture.off('update', this._onTextureUpdate);

    // Forwarded unchanged, so destroyed children see exactly what the caller asked for; the quad
    // is spared by the `_destroyGeometry` no-op, not by rewriting the flags out from under the children.
    super.destroy(options);

    // When the cascade just destroyed the material it already took the textures the caller asked
    // for, and pixi's TextureSource.destroy is not idempotent. A material that was already gone
    // beforehand freed nothing on this call, so the texture is released here instead.
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
   * No-op: the quad is a process-wide singleton behind every sprite, so no `geometry` flag may
   * free it, while the caller's own options still reach the sprite's children.
   */
  protected override _destroyGeometry(): void {}
}
