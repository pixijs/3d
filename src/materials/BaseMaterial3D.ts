import { Color, Matrix, State, Texture, warn } from 'pixi.js';
import type { ColorSource, TextureDestroyOptions, TextureSource, Topology, TypeOrBool } from 'pixi.js';

import { passBitRegistry } from '../core/render-passes/passBitRegistry';
import { RenderPassBit } from '../core/render-passes/RenderPass';
import { materialStructSnapshot, mergeMaterialStruct } from '../core/shader/codegen/materialStruct';
import type { ShaderBit } from '../core/shader/ShaderBit';
import { ShaderDescriptor } from '../core/shader/ShaderDescriptor';
import type { ShaderDescriptorOptions } from '../core/shader/ShaderDescriptor';
import { SHARED_DEFAULT_TEXTURES } from '../core/textures/DefaultTextures';
import type { View3D } from '../scene/View3D';
import { resolveDestroy3DFlag } from '../utils/Destroy3DOptions';
import { warnOnce } from '../utils/warnOnce';
import { normalizePassEntry } from './PassDescriptor';
import type { PassDescriptor, PassDescriptorOptions } from './PassDescriptor';
import { getOrCreateMaterialDataClass } from './utils/createMaterialDataClass';
import type { MaterialData } from './utils/createMaterialDataClass';
import { getOrCreateMaterialTexturesClass } from './utils/createMaterialTexturesClass';
import type { MaterialTextures } from './utils/createMaterialTexturesClass';
import { collectTextureNames } from './utils/validateMaterialTextureSlots';

/**
 * What a registered material calls when its packed data changes
 *
 * `MaterialDataStoreBuffer` implements it, and drains the queue once per frame before uploading.
 * @internal
 */
export interface MaterialUploadQueue {
  /** Queues the material's row for upload on the next drain; repeat calls before then coalesce */
  enqueueDirty(material: BaseMaterial3D): void;
  /**
   * Frees the material's row for reuse and resets its index
   *
   * Called by the material's `destroy`, and by another store's `register` when the material moves there.
   */
  remove(material: BaseMaterial3D): void;
}

/**
 * Creates the default render `State` for 3D drawing: depth test on, blending off, back-face culling on
 *
 * Every material starts from this state; property setters adjust it afterwards (e.g. `alphaMode`
 * flips blending and depth writes).
 * @returns A new `State` carrying the 3D defaults.
 * @category materials
 * @advanced
 */
export function stateFor3D(): State {
  const state = new State();

  state.depthTest = true;
  state.blend = false;
  state.culling = true;

  return state;
}

/**
 * How a material treats alpha, matching glTF's `alphaMode`
 *
 * - `'opaque'`: alpha is ignored (default)
 * - `'mask'`: fragments with alpha below {@link BaseMaterial3D#alphaCutoff} are discarded
 * - `'blend'`: alpha-blended over what is behind it
 * @example
 * ```ts
 * const leaves = new Material3D({ baseColorTexture: leafTexture, alphaMode: 'mask' });
 * ```
 * @category materials
 * @standard
 */
export type AlphaMode = 'opaque' | 'mask' | 'blend';

/**
 * Constructor options shared by every {@link BaseMaterial3D} subclass
 * @example
 * ```ts
 * interface MyGlowMaterialOptions extends BaseMaterial3DOptions {
 *   intensity?: number;
 * }
 * ```
 * @category materials
 * @standard
 */
export interface BaseMaterial3DOptions {
  /**
   * Base colour tint; the source's alpha is ignored, {@link BaseMaterial3DOptions#alpha} sets opacity
   * @example
   * ```ts
   * new Material3D({ baseColor: 0xff7733 });
   * ```
   */
  baseColor?: ColorSource;
  /**
   * Base opacity
   * @default 1
   * @example
   * ```ts
   * new Material3D({ alphaMode: 'blend', alpha: 0.4 });
   * ```
   */
  alpha?: number;
  /**
   * Base colour (albedo) texture
   * @default Texture.WHITE
   * @example
   * ```ts
   * new Material3D({ baseColorTexture: crateTexture });
   * ```
   */
  baseColorTexture?: Texture;

  /**
   * Textures by slot name, for the slots a `descriptor` or `extraBits` declares
   *
   * The bits' `textures` arrays decide which slots exist and in what order; this map only fills
   * them. A slot left out gets `Texture.WHITE`. A `baseColor` entry here wins over
   * {@link BaseMaterial3DOptions#baseColorTexture}.
   * @example
   * ```ts
   * new BaseMaterial3D({
   *   descriptor: { bitsGpu: [waterBit], bitsGl: [waterBit] },
   *   textures: { waterNormal: waterNormalTexture },
   * });
   * ```
   * @advanced
   */
  textures?: Record<string, Texture | undefined>;

  /**
   * Extra shader bits composed into the material's shader, fixed for its lifetime
   *
   * Each material documents where they sit in its bit list; with a raw `descriptor` they follow
   * the descriptor's own bits. A bit may declare material fields and textures. Fill its textures
   * through the `textures` option, or later through {@link BaseMaterial3D#textures}.
   *
   * Billboarding isn't done this way: set {@link Mesh3D#billboardMode}, which works with any
   * material.
   * @example
   * ```ts
   * new Material3D({ baseColor: 0xff3355, extraBits: [glossBit] });
   * ```
   * @advanced
   */
  extraBits?: readonly ShaderBit[];

  /**
   * How alpha is treated; see {@link AlphaMode}
   * @default 'opaque'
   * @example
   * ```ts
   * new Material3D({ baseColorTexture: leafTexture, alphaMode: 'mask' });
   * ```
   */
  alphaMode?: AlphaMode;

  /**
   * Alpha below which fragments are discarded when `alphaMode` is `'mask'`
   * @default 0.5
   * @example
   * ```ts
   * new Material3D({ baseColorTexture: leafTexture, alphaMode: 'mask', alphaCutoff: 0.3 });
   * ```
   */
  alphaCutoff?: number;

  /**
   * When `true`, back faces are drawn too and lit with their normal flipped
   *
   * Fixed at construction.
   * @default false
   * @example
   * ```ts
   * new Material3D({ baseColorTexture: leafTexture, alphaMode: 'mask', doubleSided: true });
   * ```
   */
  doubleSided?: boolean;
  /**
   * When `true`, each triangle is shaded with its face normal instead of the smooth vertex normal
   *
   * Gives low-poly scenes their hard-edged, faceted look. The face normal comes from screen-space
   * derivatives in the fragment shader, so the same geometry draws smooth or faceted depending on
   * the material, with no duplicated vertices. A normal map still applies, on top of the face
   * normal. It has no visible effect on a material that doesn't light, such as
   * {@link FlatMaterial}.
   *
   * Fixed at construction.
   * @default false
   * @example
   * ```ts
   * new Material3D({ baseColor: 0x8a7f72, flatShading: true });
   * ```
   */
  flatShading?: boolean;
  /**
   * Whether the view's distance fog may reach this material
   *
   * Fog applies only when the view has {@link View3D#fog} set and the material allows it. Turn it
   * off for skyboxes, water, and anything else with its own distance falloff: a sky dome sits past
   * the fog's far distance and would otherwise turn flat fog colour.
   *
   * Fixed at construction.
   * @default true
   * @example
   * ```ts
   * new Material3D({ baseColorTexture: skyTexture, fog: false });
   * ```
   */
  fog?: boolean;

  /**
   * Shader bits for the material's main pass, for a custom material
   *
   * Pass the plain options; they're wrapped in a {@link ShaderDescriptor}. The material's texture
   * slots and packed data are laid out from `bitsGpu`, and both backends use that layout, so
   * `bitsGl` must declare the same texture names in the same order. The constructor throws if it
   * doesn't.
   *
   * A material whose bits change with its settings overrides
   * {@link BaseMaterial3D#getPrimaryDescriptor} instead.
   * @example
   * ```ts
   * new BaseMaterial3D({
   *   descriptor: { bitsGpu: [myBit], bitsGl: [myBit] },
   * });
   * ```
   * @advanced
   */
  descriptor?: ShaderDescriptorOptions;

  /**
   * Extra render passes this material draws in, keyed by the pass's `name`
   *
   * - `true`: draw in the pass with the pass's own shader and state.
   * - a {@link PassDescriptorOptions} object: draw in it with your own shader, state or topology.
   *   {@link PassDescriptor} explains how these combine with the pass's own, and why they can't
   *   change later.
   * - `false`, or left out: don't draw in it. Useful for opting out of a pass that spread options
   *   or a subclass default turned on.
   *
   * A material can name a pass before the pass exists.
   * @example
   * ```ts
   * view.passes = [new OutlinePass({ width: 0.05 })];
   * const hero = new Material3D({ baseColor: 0xff7733, passes: { outline: true } });
   * ```
   */
  passes?: Record<string, PassDescriptorOptions | boolean>;

  /**
   * Primitive topology for every pass that doesn't set its own; left out, the geometry's is used
   *
   * `'line-list'` joins the indices in pairs, so a triangle index buffer drawn that way isn't a
   * wireframe: it draws some edges and misses others. Use a geometry with line indices for that.
   * @example
   * ```ts
   * new FlatMaterial({ baseColor: 0x00ff00, topology: 'point-list' });
   * ```
   */
  topology?: Topology;

  /**
   * UV transform for every texture of the material, as glTF's `KHR_texture_transform` gives it
   *
   * Leave it out to let a framed (spritesheet) base colour texture set the transform. Setting one
   * takes over until it's cleared; see {@link BaseMaterial3D#uvTransform}.
   * @example
   * ```ts
   * new Material3D({ baseColorTexture: tileTexture, uvTransform: new Matrix().scale(4, 4) });
   * ```
   */
  uvTransform?: Matrix;
}

let UID = 0;

/** Identity 2x2 block for a cleared / underived UV transform */
const IDENTITY_UV_ROW0 = new Float32Array([1, 0, 0, 1]);

/**
 * Upload method of pixi's base `TextureSource`, which has no CPU resource to upload from
 *
 * Render textures and `ContainerSource`s carry it: their pixels exist only on the GPU. Image,
 * canvas, buffer, video and compressed sources each name their own method.
 */
const GPU_ONLY_UPLOAD_METHOD = 'unknown';

/**
 * Whether a texture's frame covers its whole source with no packer rotation (nothing to honour)
 *
 * A rotated texture never counts, even when its frame covers the whole source, as in pixi's
 * `TextureMatrix.isSimple`.
 * @param texture - Texture whose frame and rotation are checked
 */
function isFullFrame(texture: Texture): boolean {
  if (texture.rotate !== 0) return false;
  if (texture.noFrame) return true;
  const frame = texture.frame;
  return (
    frame.x === 0 && frame.y === 0 && frame.width === texture.source.width && frame.height === texture.source.height
  );
}

/**
 * Converts an sRGB (display-domain) channel to linear light, the shader's working space
 *
 * Every `ColorSource` material input (baseColor, emissive, sheen/specular/attenuation tints) is
 * authored in display space and decoded at write time. The glTF loader pre-encodes its
 * spec-linear factors to compensate.
 * @param channel - Normalised sRGB channel value.
 * @returns The linear-light channel value.
 * @category materials
 * @advanced
 */
export function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * Converts a linear-light channel to an sRGB (display-domain) channel — the inverse of {@link srgbToLinear}
 * @param channel - Linear-light channel value.
 * @returns The sRGB channel value.
 * @category materials
 * @advanced
 */
export function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

/**
 * Writes a colour's rgb into packed data at `offset`, sRGB-decoded to linear light and scaled
 *
 * `scale` premultiplies light intensity at upload.
 * @param target - Packed float array to write into.
 * @param offset - Component offset of the rgb triple.
 * @param color - Display-space colour to decode.
 * @param scale - Intensity premultiplier.
 * @internal
 */
export function writeLinearRgb(target: Float32Array, offset: number, color: Color, scale = 1): void {
  target[offset] = srgbToLinear(color.red) * scale;
  target[offset + 1] = srgbToLinear(color.green) * scale;
  target[offset + 2] = srgbToLinear(color.blue) * scale;
}

/**
 * Accumulates a colour's rgb into `target` at `offset`, sRGB-decoded and scaled — for summed ambient terms
 * @param target - Packed float array to accumulate into.
 * @param offset - Component offset of the rgb triple.
 * @param color - Display-space colour to decode.
 * @param scale - Intensity premultiplier.
 * @internal
 */
export function addLinearRgb(target: Float32Array, offset: number, color: Color, scale: number): void {
  target[offset] += srgbToLinear(color.red) * scale;
  target[offset + 1] += srgbToLinear(color.green) * scale;
  target[offset + 2] += srgbToLinear(color.blue) * scale;
}

/**
 * Base class for all 3D materials
 *
 * Holds what every material shares: base colour and alpha, the alpha mode, render state, texture
 * slots, a UV transform, and the packed data its shader reads. {@link Material3D},
 * {@link PhongMaterial} and {@link FlatMaterial} build on it. A custom material passes its shader
 * bits as `descriptor`.
 *
 * ## Changing a material that has rendered
 *
 * Meshes pick up most changes on the next render by themselves: property setters such as
 * `baseColor` or `alphaMode`, texture swaps, {@link BaseMaterial3D#enablePass} and
 * {@link BaseMaterial3D#disablePass}. So do the view-wide `toneMapping`, `fog`, `environment` and
 * `shadowFilter`. A few changes need help:
 *
 * - {@link BatchedMesh3D} slots only see a changed material after
 *   {@link BatchedMesh3D#invalidate}, once per slot.
 * - After changing {@link BaseMaterial3D#toneMapped}, {@link BaseMaterial3D#vertexColors} or
 *   {@link BaseMaterial3D#lit}, call {@link Mesh3D#invalidate} on each mesh using the material so
 *   it rebuilds its shader.
 * - After changing a field of `material.state`, do the same: WebGPU replays the draws it
 *   recorded with the old state.
 * - After switching `alphaMode` to or from `'blend'`, call {@link Mesh3D#updateShadow} on each
 *   mesh: blended materials cast no shadow, and the mesh doesn't recheck on its own.
 * - The `passes` overrides can't change. Build a new material and assign it instead.
 * @example
 * ```ts
 * class MyGlowMaterial extends BaseMaterial3D {
 *   public override lit = false;
 *
 *   constructor() {
 *     super({ descriptor: { bitsGpu: [myGlowBit], bitsGl: [myGlowBit] } });
 *   }
 * }
 *
 * const orb = new Mesh3D({ geometry: new SphereGeometry(), material: new MyGlowMaterial() });
 * ```
 * @category materials
 * @standard
 */
export class BaseMaterial3D<
  TData extends MaterialData = MaterialData,
  TTextures extends MaterialTextures = MaterialTextures,
> {
  /**
   * Unique id for this material instance
   * @advanced
   */
  public uid = UID++;

  /**
   * Render state (blending, depth, culling) for every draw with this material
   *
   * `alphaMode` and `doubleSided` set parts of it. Changing a field after the material has
   * rendered needs {@link Mesh3D#invalidate} on its meshes, as the class notes explain.
   * @example
   * ```ts
   * const overlay = new FlatMaterial({ baseColor: 0xffcc00 });
   * overlay.state.depthTest = false;
   * ```
   */
  public state: State;

  /** Whether `destroy()` has run */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only state
  public destroyed = false;

  /**
   * Primitive topology for every pass that doesn't set its own, from the `topology` option
   *
   * {@link PassDescriptor} lists where it falls among the other sources of a topology.
   */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only state
  public readonly topology?: Topology;

  /**
   * Every texture of the material, in slot order
   *
   * `_deriveLayoutFromBits` fills it by walking the bits' `textures` declarations, the same walk
   * that numbers the compiled shader's samplers; `validateMaterialTextureSlots` checks the two
   * still agree. The batcher packs textures from it, and its length, capped at 15, groups
   * materials by texture count in the sort key.
   * @internal
   */
  public _textures: Texture[] = [];

  /**
   * Slot index of each texture name, filled with `_textures`
   *
   * Read by `validateMaterialTextureSlots` and wherever the `baseColor` slot is looked up by name.
   * The `textures` accessors don't use it; each one bakes its index.
   * @internal
   */
  public _slotByName: Record<string, number> = Object.create(null);

  /** Staged linear rgb of the base tint — written before `data` exists, copied in at derivation */
  private readonly _baseColorLinear = new Float32Array([1, 1, 1]);
  /** Canonical hex of the base tint — `Container.tint`-style read-back */
  private _baseColorTint = 0xffffff;
  private _alpha = 1;
  private _alphaCutoff: number = 0.5;
  protected _alphaMode: AlphaMode = 'opaque';

  /**
   * Render passes this material draws in, as pass bits
   *
   * Holds `OPAQUE` or `TRANSPARENT` from `alphaMode` (`Material3D` puts `TRANSMISSION` in their
   * place), plus a bit for each custom pass joined through the `passes` option or `enablePass`.
   * Meshes read it live through {@link Mesh3D#renderPassMask}, so adding a bit after construction
   * must also call `_markDescriptorDirty`: a mesh that joins a pass needs its cache entry for that
   * pass built the same frame. Removing one needs nothing; the stale entry is just no longer read.
   * @internal
   */
  public _passBit: number = RenderPassBit.OPAQUE;

  /**
   * Row of this material in its renderer's material store, or `-1` before its first render
   *
   * Each mesh's store row carries it, so the shader can find the material's data.
   * @internal
   */
  public _materialIndex = -1;

  private _textureCacheKey = -1;

  /**
   * Version bumped whenever this material's shader variant or pass membership changes
   *
   * Each mesh keeps the version it last rebuilt against (`Mesh3D._lastDescriptorDirtyId`) and
   * compares its own copy, so every mesh sharing the material rebuilds, not only the first one the
   * scene walk reaches. Batch slots aren't walked and don't read it; `BatchedMesh3D.invalidate` is
   * their manual equivalent. Bump it only through `_markDescriptorDirty`.
   * @internal
   */
  public _descriptorDirtyId = 0;

  /** Whether back faces are drawn too, lit with their normal flipped; set by the `doubleSided` option */
  // oxlint-disable-next-line pixi3d/require-standard-example -- read-only state
  public readonly doubleSided: boolean;

  /**
   * Whether the view's tone-mapping curve applies to this material
   *
   * Turn it off for unlit, overlay and gizmo materials. It's read when a mesh builds its shader,
   * so set it before the material first renders; a later change needs {@link Mesh3D#invalidate}
   * on each mesh.
   * @default true
   * @example
   * ```ts
   * class MySkyMaterial extends BaseMaterial3D {
   *   public override toneMapped = false;
   * }
   * ```
   */
  public toneMapped = true;

  /**
   * Whether the view's fog may reach this material; set by the {@link BaseMaterial3DOptions#fog | fog} option
   *
   * The fog settings themselves live on {@link View3D#fog}.
   * @example
   * ```ts
   * const sky = new Material3D({ baseColorTexture: skyTexture, fog: false });
   * ```
   */
  public readonly fog: boolean;

  /**
   * Whether triangles are shaded with their face normal; set by the
   * {@link BaseMaterial3DOptions#flatShading | flatShading} option
   * @example
   * ```ts
   * const rock = new Material3D({ baseColor: 0x8a7f72, flatShading: true });
   * ```
   */
  public readonly flatShading: boolean;

  /**
   * Whether a geometry's vertex colours (its `colors`) tint this material
   *
   * Off by default because exporters often fill the colour set with data that isn't colour, such
   * as a wind stiffness mask, a texture blend weight or baked occlusion, and tinting by those is
   * wrong. The glTF loader turns it on, since glTF defines `COLOR_0` as a base colour multiplier.
   * The second set, `colors1`, never tints, so it's the place for data when the exporter allows
   * it.
   *
   * It's read when a mesh builds its shader; changing it after the material has rendered needs
   * {@link Mesh3D#invalidate} on each mesh.
   * @default false
   * @example
   * ```ts
   * const painted = new Material3D();
   * painted.vertexColors = true;
   * ```
   */
  public vertexColors = false;

  /**
   * Whether the material's shader does lighting
   *
   * When `true`, the engine adds `calculateShadow` for the shader's light loop to call, and a
   * billboarded mesh turns its normal with it. A shader that does no lighting sets it to `false`,
   * as {@link FlatMaterial} does; `calculateShadow` is then left out, so a shader calling it fails
   * to compile. Which lighting model a lit shader uses is up to the material.
   *
   * Like {@link BaseMaterial3D#toneMapped}, it's read when a mesh builds its shader.
   * @default true
   * @example
   * ```ts
   * class MyUnlitMaterial extends BaseMaterial3D {
   *   public override lit = false;
   * }
   * ```
   */
  public lit = true;

  /** `data.uvTransformRow0`, held directly; `undefined` when the bits declare no UV transform (no `uvTransformBit`) */
  private _uvTransformRow0?: Float32Array;

  /** `data.uvOffset`, held alongside `_uvTransformRow0` */
  private _uvOffset?: Float32Array;

  /** Whether `uvTransform` holds a matrix the user set, which suspends frame derivation */
  private _uvTransformExplicit: boolean;

  private _uvTransform?: Matrix;

  /** Construction `uvTransform` value, applied once `_deriveLayoutFromBits` wires the data views */
  private _initialUvTransform?: Matrix;

  /**
   * Snapshot of this material's packed struct, as merged from its construction bits
   *
   * `validateMaterialStruct` checks every compiled shader's struct against it.
   * @internal
   */
  public _materialStructSnapshot = '{}';

  /**
   * The values the material's shader reads, laid out exactly as its packed GPU struct
   *
   * One field per struct member; assigning a field queues the upload ({@link MaterialData} covers
   * vector fields). Built from the material's bits during construction; a material with no bits
   * gets an empty one.
   * @example
   * ```ts
   * const toon = new ToonMaterial({ bands: 3 });
   * toon.data.bands = 5;
   * ```
   */
  public data!: TData;

  /**
   * The material's textures by slot name, the same names the `textures` option takes
   *
   * Assigning swaps the slot, and a name the material doesn't have throws. A swap reuses the
   * compiled shader, except that putting a real map into the `normal` slot, or the default back,
   * switches between the normal-mapped and plain variants.
   * @example
   * ```ts
   * material.textures.baseColor = crateTexture;
   * ```
   */
  public textures!: TTextures;

  /**
   * The store this material's data uploads through, wired by the store's `register` on first render
   *
   * Another renderer's store re-wires it when it first draws the material. `destroy` clears it, so
   * a late `update()` does nothing.
   * @internal
   */
  public _uploadQueue: MaterialUploadQueue | null = null;

  /**
   * Coalescing flag owned by the upload queue
   *
   * Raised on enqueue, lowered by the queue's per-frame update; `destroy` lowers it too, since
   * the drain drops a destroyed material's entry without touching it.
   * @internal
   */
  public _storeQueued = false;

  /**
   * Queues this material's data for upload, as `Texture.update()` does for a texture
   *
   * Property setters and `data` field assignments call it for you. Call it yourself after writing
   * into a `data` vector in place. Calls in one frame upload once, and calls before the first render
   * do nothing because that render uploads the whole row.
   * @example
   * ```ts
   * const scroll = material.data.scrollOffset;
   * scroll[0] += 0.01;
   * material.update();
   * ```
   */
  public update(): void {
    this._uploadQueue?.enqueueDirty(this);
  }

  /**
   * Whether `getPrimaryDescriptor` has to rebuild its bit list before returning
   *
   * Set by `_invalidateDescriptor`; the override that rebuilds clears it.
   * @internal
   */
  protected _variantDirty = true;

  /**
   * The material's overrides for each pass, keyed by pass bit, from the `passes` option
   *
   * A pass reads `_passes[bit]` and falls back to its own descriptor when there's no entry.
   * Construction-only: each mesh resolves its entry once (see {@link PassDescriptor}), and a
   * material doesn't know its meshes to tell them about a change.
   * @internal
   */
  public _passes: Record<number, PassDescriptor> = {};

  /** Construction-fixed user extension bits, see {@link BaseMaterial3DOptions#extraBits} */
  protected readonly _extraBits: readonly ShaderBit[];

  /**
   * Stored descriptor for the default `getPrimaryDescriptor`
   * @internal
   */
  protected _descriptor?: ShaderDescriptor;

  constructor(options: BaseMaterial3DOptions = {}) {
    if (options.baseColor !== undefined) this.baseColor = options.baseColor;
    this._alpha = options.alpha ?? 1;
    this._alphaCutoff = options.alphaCutoff ?? 0.5;

    this.state = stateFor3D();

    this.alphaMode = options.alphaMode ?? 'opaque';
    this.doubleSided = options.doubleSided ?? false;
    this.state.culling = !this.doubleSided;
    this.flatShading = options.flatShading ?? false;
    this.fog = options.fog ?? true;
    this._extraBits = options.extraBits ?? [];

    this._uvTransformExplicit = !!options.uvTransform;
    this._initialUvTransform = options.uvTransform;

    if (options.descriptor) {
      const descriptor = options.descriptor;
      const extra = this._extraBits;

      this._descriptor = new ShaderDescriptor(
        extra.length === 0
          ? descriptor
          : {
              ...descriptor,
              bitsGpu: [...(descriptor.bitsGpu ?? []), ...extra],
              bitsGl: [...(descriptor.bitsGl ?? []), ...extra],
            },
      );

      this._deriveLayoutFromBits(this._descriptor.bitsGpu, {
        baseColor: options.baseColorTexture,
        ...options.textures,
      });

      const glNames = collectTextureNames(this._descriptor.bitsGl).join('|');
      const gpuNames = collectTextureNames(this._descriptor.bitsGpu).join('|');
      if (glNames !== gpuNames) {
        throw new Error(
          `[BaseMaterial3D] descriptor.bitsGl declares textures [${glNames}] but bitsGpu declares ` +
            `[${gpuNames}] — both backends pack from the same derived slots, so the sequences must match.`,
        );
      }
    }

    if (options.passes) {
      for (const name in options.passes) {
        const value = options.passes[name];
        if (!value) continue;
        const bit = passBitRegistry.getOrAllocate(name);
        if (value !== true) {
          this._passes[bit] = normalizePassEntry(value);
        }
        this._passBit |= bit;
      }
    }
    this.topology = options.topology;

    this.data ??= new (getOrCreateMaterialDataClass({}, '{}'))(this) as TData;
  }

  /**
   * Sort key that places materials sharing a first texture next to each other
   *
   * Built from the first slot's source uid, which is the base colour on every built-in material,
   * so meshes with the same albedo sort together and the batcher reuses texture slots. A locality
   * hint only; it's rebuilt on the first read after `_markDescriptorDirty` resets it.
   * @internal
   */
  get textureCacheKey() {
    if (this._textureCacheKey !== -1) return this._textureCacheKey;

    this._textureCacheKey = this._textures.length > 0 ? this._textures[0].source.uid & 0xffff : 0;
    return this._textureCacheKey;
  }

  /**
   * Lays out this material's packed data and texture slots from `bits`, once, at construction
   *
   * The packed struct merges every bit's `bindings.material` fields; `data` is created in that
   * layout and `_materialStructSnapshot` records it. The texture slots come from walking the bits'
   * `textures` declarations in order, which builds `_textures`, `_slotByName` and `textures`; the
   * `textures` argument fills them by name, and a name it leaves out gets `Texture.WHITE`. The
   * base colour, alpha and cutoff staged before `data` existed are copied in, and the UV transform
   * is pointed at its fields. Slots are filled directly rather than through `_setTextureSlot`, so
   * the UV frame is derived once, at the end.
   *
   * `bits` must hold every bit `getPrimaryDescriptor()` compiles that declares material fields or
   * textures. Leave one out (`uvTransformBit` declares two fields and no textures) and
   * `validateMaterialStruct` rejects the shader when it's built. A bit added only at compile time,
   * such as the alpha-mask or environment bits, must declare nothing the list doesn't already.
   *
   * `data` and `textures` are cast to `TData` and `TTextures` unchecked, so a subclass's type
   * arguments have to describe what its bits declare.
   *
   * Subclasses that assemble their own bits call this from their constructor; a raw `descriptor`
   * is laid out automatically. Throws if two bits declare the same texture name, which would
   * otherwise fail later, less legibly, as two `sampleX` functions in one shader.
   * @param bits - The bits the primary descriptor compiles that declare fields or textures.
   * @param textures - Slot content by declared texture name.
   */
  protected _deriveLayoutFromBits(
    bits: readonly ShaderBit[],
    textures: Record<string, Texture | undefined> = {},
  ): void {
    const _textures = this._textures;
    _textures.length = 0;

    this._slotByName = Object.create(null);

    const structDef = mergeMaterialStruct(bits);
    this._materialStructSnapshot = materialStructSnapshot(structDef);
    this.data = new (getOrCreateMaterialDataClass(structDef, this._materialStructSnapshot))(this) as TData;

    const baseColor = this.data.baseColor;
    if (baseColor) {
      baseColor.set(this._baseColorLinear);
      baseColor[3] = this._alpha;
    }
    if (typeof this.data.alphaCutoff === 'number') this.data.alphaCutoff = this._alphaCutoff;
    if (this.data.uvTransformRow0 !== undefined) {
      this._uvTransformRow0 = this.data.uvTransformRow0;
      this._uvOffset = this.data.uvOffset;
      this._uvTransformRow0.set(IDENTITY_UV_ROW0);
      if (this._initialUvTransform) {
        this.uvTransform = this._initialUvTransform;
        this._initialUvTransform = undefined;
      }
    }

    const slotNames: string[] = [];
    for (const bit of bits) {
      if (!bit.textures) continue;
      for (const name of bit.textures) {
        if (this._slotByName[name] !== undefined) {
          throw new Error(
            `[BaseMaterial3D] Duplicate texture '${name}' — bit "${bit.name}" redeclares a name another ` +
              `bit in this material already claimed.`,
          );
        }
        this._slotByName[name] = _textures.length;
        _textures.push(textures[name] ?? Texture.WHITE);
        slotNames.push(name);
      }
    }

    this.textures = new (getOrCreateMaterialTexturesClass(slotNames))(this) as TTextures;

    this._deriveUvFrame();
  }

  /**
   * Puts a texture in one slot; every write through `textures` comes here
   *
   * A swap to another frame of the same source (an atlas frame flip) re-keys nothing: batch
   * slots, bind group hashes and the sort key all follow the source's uid. A swap to a different
   * source marks the descriptor dirty so meshes re-key. The swap never touches the packed data;
   * only the UV frame can, and `_deriveUvFrame` queues its own upload.
   *
   * A framed texture in a slot other than `baseColor` warns unless its frame matches the current
   * transform. There is one UV transform for every slot, derived from `baseColor`, so a secondary
   * map packed in a different frame would sample the wrong part of its atlas.
   * @param index - Slot index into `_textures`.
   * @param value - The texture to place in the slot.
   * @internal
   */
  public _setTextureSlot(index: number, value: Texture): void {
    const prev = this._textures[index];
    if (prev === value) return;
    this._textures[index] = value;

    if (prev?.source !== value.source) this._markDescriptorDirty();

    if (index === this._slotByName.baseColor) {
      this._deriveUvFrame();
    } else if (this._uvTransformRow0 && !isFullFrame(value) && !this._frameMatchesTransform(value)) {
      warnOnce(
        'pixi3d-uv-frame-secondary',
        '[pixi-3d] A framed texture landed in a non-baseColor slot but the material UV transform ' +
          "(derived from the baseColor slot, or set explicitly) doesn't match its frame. The shared " +
          'transform cannot serve per-slot frames — pack secondary maps to match the baseColor frame.',
      );
    }
  }

  /**
   * Returns the shader descriptor for the material's main pass
   *
   * The base returns the `descriptor` the material was built with. Override it when the bits depend
   * on the material's settings or on the view, and call `_invalidateDescriptor` when a setting
   * changes the answer. Bits that declare material fields or textures must also go through
   * `_deriveLayoutFromBits` in the constructor.
   * @param _view - The view about to render this material.
   * @returns The shader descriptor for the material's main pass.
   * @example
   * ```ts
   * class MyWaterMaterial extends BaseMaterial3D {
   *   private readonly _plain = new ShaderDescriptor({ bitsGpu: [waterBit], bitsGl: [waterBit] });
   *   private readonly _reflective = new ShaderDescriptor({
   *     bitsGpu: [waterBit, skyReflectionBit],
   *     bitsGl: [waterBit, skyReflectionBit],
   *   });
   *
   *   constructor() {
   *     super();
   *     this._deriveLayoutFromBits([waterBit]);
   *   }
   *
   *   public override getPrimaryDescriptor(view: View3D): ShaderDescriptor {
   *     return view.environment ? this._reflective : this._plain;
   *   }
   * }
   * ```
   * @advanced
   */
  public getPrimaryDescriptor(_view: View3D): ShaderDescriptor {
    return this._descriptor!;
  }

  /**
   * Adds this material to a custom render pass, such as an {@link OutlinePass}
   *
   * Does what naming the pass `true` in the `passes` option does, after construction. Meshes using
   * the material draw in the pass from the next render. {@link BatchedMesh3D} slots don't follow:
   * their passes come from {@link BatchedMesh3D#setItemActive}. Per-material overrides for a pass
   * can only be given at construction, through `passes`.
   * @param name - The pass's `name`, such as `'outline'`.
   * @example
   * ```ts
   * view.passes = [new OutlinePass()];
   * material.enablePass('outline');
   * ```
   */
  public enablePass(name: string): void {
    const prev = this._passBit;

    this._passBit |= passBitRegistry.getOrAllocate(name);
    if (this._passBit !== prev) this._markDescriptorDirty();
  }

  /**
   * Removes this material from a custom render pass
   *
   * Meshes using the material leave the pass on the next render. An override given for the pass
   * in the `passes` option is kept, so {@link BaseMaterial3D#enablePass} brings it back. Does
   * nothing for a pass name nothing has used yet.
   * @param name - The pass's `name`, such as `'outline'`.
   * @example
   * ```ts
   * material.disablePass('outline');
   * ```
   */
  public disablePass(name: string): void {
    const bit = passBitRegistry.get(name);
    if (bit !== undefined) this._passBit &= ~bit;
  }

  /**
   * Resets the sort key and bumps `_descriptorDirtyId`, so every mesh using the material rebuilds
   *
   * The two move together. `_textureCacheKey` is memoised, so on its own the first mesh to read it
   * would consume the change and the others would keep a stale, or missing, pass cache entry.
   * Every reset of `_textureCacheKey` goes through here.
   */
  private _markDescriptorDirty(): void {
    this._textureCacheKey = -1;
    this._descriptorDirtyId++;
  }

  /**
   * Marks the descriptor stale and makes every mesh using the material rebuild its shader
   *
   * The next `getPrimaryDescriptor()` call rebuilds the descriptor. Call it from a subclass setter
   * whose value changes the bit list.
   */
  protected _invalidateDescriptor(): void {
    this._variantDirty = true;
    this._markDescriptorDirty();
  }

  /**
   * How the material treats alpha; see {@link AlphaMode}
   *
   * Setting it also sets blending and depth writes, and moves the material between the opaque and
   * transparent passes. `'blend'` turns depth writes off, so a see-through surface doesn't hide
   * what is drawn behind it later. With a raw `descriptor`, `'mask'` discards only if the
   * descriptor's bits include `alphaMaskBit`.
   *
   * After switching to or from `'blend'`, call {@link Mesh3D#updateShadow} on each mesh using the
   * material: blended materials cast no shadow, and the mesh doesn't recheck on its own.
   * @example
   * ```ts
   * material.alphaMode = 'blend';
   * material.alpha = 0.5;
   * ```
   */
  get alphaMode(): AlphaMode {
    return this._alphaMode;
  }

  /**
   * Switches the alpha mode, updating blending, depth writes, pass membership and the shader variant
   * @param value - How alpha is treated: ignored, cut off, or blended
   */
  set alphaMode(value: AlphaMode) {
    if (this._alphaMode === value) return;
    this._alphaMode = value;
    const isBlend = value === 'blend';
    this.state.blend = isBlend;
    this.state.depthMask = !isBlend;

    const coreMask = RenderPassBit.OPAQUE | RenderPassBit.TRANSPARENT;
    this._passBit = (this._passBit & ~coreMask) | (isBlend ? RenderPassBit.TRANSPARENT : RenderPassBit.OPAQUE);
    this.update();
    this._invalidateDescriptor();
  }

  /**
   * Base colour tint, read back as a hex number
   *
   * Takes any `ColorSource` in display (sRGB) space, like `Container.tint`; the shader gets it in
   * linear light. The source's alpha is ignored; {@link BaseMaterial3D#alpha} is the opacity.
   * @example
   * ```ts
   * material.baseColor = 'tomato';
   * material.baseColor; // 0xff6347
   * ```
   */
  public get baseColor(): number {
    return this._baseColorTint;
  }

  /**
   * Sets the tint from any display-space `ColorSource`, syncing the packed linear-light rgb
   * @param value - Display-space tint; its alpha is ignored
   */
  public set baseColor(value: ColorSource) {
    const colour = Color.shared.setValue(value);
    this._baseColorTint = colour.toNumber();
    writeLinearRgb(this._baseColorLinear, 0, colour);
    const packed = this.data?.baseColor;
    if (packed) {
      packed.set(this._baseColorLinear);
      this.update();
    }
  }

  /**
   * Base opacity, from 0 to 1
   * @default 1
   * @example
   * ```ts
   * material.alphaMode = 'blend';
   * material.alpha = 0.5;
   * ```
   */
  public get alpha(): number {
    return this._alpha;
  }

  /**
   * Sets the base opacity, syncing the alpha lane of the packed base colour
   * @param value - Opacity from 0 (transparent) to 1 (opaque)
   */
  public set alpha(value: number) {
    if (this._alpha === value) return;
    this._alpha = value;
    const packed = this.data?.baseColor;
    if (packed) {
      packed[3] = value;
      this.update();
    }
  }

  /**
   * Alpha below which fragments are discarded while {@link BaseMaterial3D#alphaMode} is `'mask'`
   * @default 0.5
   * @example
   * ```ts
   * material.alphaMode = 'mask';
   * material.alphaCutoff = 0.3;
   * ```
   */
  public get alphaCutoff(): number {
    return this._alphaCutoff;
  }

  /**
   * Sets the discard threshold used while {@link BaseMaterial3D#alphaMode} is `'mask'`
   * @param value - Alpha below which fragments are discarded
   */
  public set alphaCutoff(value: number) {
    if (this._alphaCutoff === value) return;
    this._alphaCutoff = value;
    if (typeof this.data?.alphaCutoff === 'number') this.data.alphaCutoff = value;
  }

  /**
   * The UV transform you set, or `undefined` while the base colour texture's frame sets it
   *
   * It implements glTF's `KHR_texture_transform`. One transform applies to every texture of the
   * material, in the vertex shader; there is no per-texture transform.
   *
   * Setting a matrix takes over: a framed (spritesheet) base colour texture no longer sets the
   * transform, and warns. Setting `undefined` hands it back, deriving it again from whatever is in
   * the `baseColor` slot. Either way it's a data write, never a shader rebuild. On a material whose
   * bits have no `uvTransformBit`, setting a matrix warns and does nothing.
   *
   * The 2x2 part applies transposed relative to pixi's `Matrix.apply`: a UV `(u, v)` becomes
   * `(a * u + b * v + tx, c * u + d * v + ty)`. A matrix built as
   * `new Matrix().scale(sx, sy).rotate(rotation).translate(x, y)` then gives the
   * `KHR_texture_transform` result for those values, which is how the glTF loader builds it.
   *
   * The getter returns the material's own copy. Changing it in place does nothing until you assign
   * it again.
   * @example
   * ```ts
   * material.uvTransform = new Matrix().scale(4, 4);
   * material.uvTransform = undefined;
   * ```
   */
  public get uvTransform(): Matrix | undefined {
    return this._uvTransform;
  }

  /**
   * Sets the UV transform, or `undefined` to derive it from the base colour frame again
   * @param m - Transform shared by every texture binding, or `undefined` to hand it back
   */
  public set uvTransform(m: Matrix | undefined) {
    if (!this._uvTransformRow0) {
      if (m) {
        warn(
          "BaseMaterial3D: uvTransform is inert — this material's descriptor bits declare no " +
            'uvTransform fields (include uvTransformBit to enable it).',
        );
      }
      return;
    }

    if (!m) {
      this._uvTransformExplicit = false;
      this._uvTransform = undefined;
      this._uvTransformRow0.set(IDENTITY_UV_ROW0);
      this._uvOffset!.fill(0);
      this.update();
      this._deriveUvFrame();
      return;
    }

    this._uvTransformExplicit = true;
    this._uvTransform ??= new Matrix();

    this._uvTransform.copyFrom(m);
    this._uvTransformRow0![0] = m.a;
    this._uvTransformRow0![1] = m.b;
    this._uvTransformRow0![2] = m.c;
    this._uvTransformRow0![3] = m.d;
    this._uvOffset![0] = m.tx;
    this._uvOffset![1] = m.ty;

    this.update();
  }

  /**
   * Sets the UV transform from the base colour texture's frame, so a spritesheet frame maps onto
   * the mesh's UVs as pixi maps it onto a sprite
   *
   * The frame's corner UVs give the affine exactly: the edges from the top-left corner to the
   * top-right and to the bottom-left are the 2x2 columns, which covers rotated frames with no
   * special case, and the top-left corner is the offset. The values are rounded to float32 first,
   * so comparing them with the stored row is exact and an unchanged frame queues no upload. An
   * unframed texture, or no `baseColor` slot, resets to identity; a trimmed one warns, since only
   * its frame applies. A user-set `uvTransform` suspends all of this.
   *
   * Public because owners that change a texture's frame in place, such as {@link Sprite3D}, make
   * no slot write to trigger it, so they call it themselves.
   * @internal
   */
  public _deriveUvFrame(): void {
    const row0 = this._uvTransformRow0;
    const offset = this._uvOffset;
    if (!row0 || !offset) return;

    const slot = this._slotByName.baseColor;
    const texture = slot === undefined ? undefined : this._textures[slot];
    const framed = texture !== undefined && !isFullFrame(texture);

    if (this._uvTransformExplicit) {
      if (framed) {
        warnOnce(
          'pixi3d-uv-frame-explicit',
          '[pixi-3d] A framed baseColor texture was assigned but the material has an explicit ' +
            'uvTransform, which wins — the frame is not applied. Clear material.uvTransform to ' +
            'derive from the texture frame.',
        );
      }
      return;
    }

    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    let tx = 0;
    let ty = 0;

    if (framed) {
      if (texture.trim) {
        warnOnce(
          'pixi3d-uv-frame-trimmed',
          '[pixi-3d] The baseColor texture is trimmed. Trims describe where a sprite quad shrank ' +
            'and cannot map onto arbitrary mesh UVs — the trim is ignored; only the frame applies. ' +
            'Pack 3D textures without trimming.',
        );
      }
      const uvs = texture.uvs;
      a = Math.fround(uvs.x1 - uvs.x0);
      b = Math.fround(uvs.x3 - uvs.x0);
      c = Math.fround(uvs.y1 - uvs.y0);
      d = Math.fround(uvs.y3 - uvs.y0);
      tx = Math.fround(uvs.x0);
      ty = Math.fround(uvs.y0);
    }

    if (row0[0] === a && row0[1] === b && row0[2] === c && row0[3] === d && offset[0] === tx && offset[1] === ty) {
      return;
    }

    row0[0] = a;
    row0[1] = b;
    row0[2] = c;
    row0[3] = d;
    offset[0] = tx;
    offset[1] = ty;
    this.update();
  }

  /**
   * Whether a texture's frame maps to exactly the transform currently in the material row (f32 compare)
   * @param texture - Texture whose UVs are compared against the material row
   */
  private _frameMatchesTransform(texture: Texture): boolean {
    const row0 = this._uvTransformRow0!;
    const offset = this._uvOffset!;
    const uvs = texture.uvs;
    return (
      row0[0] === Math.fround(uvs.x1 - uvs.x0) &&
      row0[1] === Math.fround(uvs.x3 - uvs.x0) &&
      row0[2] === Math.fround(uvs.y1 - uvs.y0) &&
      row0[3] === Math.fround(uvs.y3 - uvs.y0) &&
      offset[0] === Math.fround(uvs.x0) &&
      offset[1] === Math.fround(uvs.y0)
    );
  }

  /**
   * Give the GPU memory of this material's textures back now — for content that is out of
   * rotation for a while. Each texture source's GPU copy is freed and re-uploaded from its
   * CPU-side resource by the next frame that samples it, so the material keeps rendering
   * identically; the cost is that one frame's re-upload.
   *
   * Texture sources are shared freely between materials, and this frees the source, not the
   * material's claim on it: every other material pointing at the same source gives up its GPU
   * copy too, and gets it back the same way. That is the same contract as calling
   * `texture.source.unload()` yourself. Each source is unloaded once, however many of the
   * material's textures share it. The engine's default textures (white, empty and flat
   * normal) are process-wide singletons bound by views that never asked for this, and are
   * always skipped.
   *
   * So is any source with nothing to re-upload from — a `ContainerSource` or a
   * `RenderTexture`, whose pixels exist only on the GPU. Unloading one would leave the
   * material sampling an empty texture until its owner renders it again, so those are the
   * owner's to re-render, not this method's to unload.
   *
   * The material's own CPU state — the packed struct, its store row, the compiled shaders —
   * is untouched. Idempotent, and a no-op once destroyed.
   * @example
   * ```ts
   * view.root.removeChild(model);
   * material.unload(); // hand the texture memory back until the model is shown again
   * ```
   * @see {@link Model3D.unload} For giving back a whole model's geometry and textures at once.
   * @see {@link BaseMaterial3D.destroy} For permanent teardown.
   */
  public unload(): void {
    if (this.destroyed) return;

    const seenSources = new Set<TextureSource>();
    for (const texture of this._textures) {
      if (!texture || SHARED_DEFAULT_TEXTURES.has(texture)) continue;
      const source = texture.source;
      if (!source || seenSources.has(source)) continue;
      seenSources.add(source);
      if (source.uploadMethodId === GPU_ONLY_UPLOAD_METHOD) continue;
      source.unload();
    }
  }

  /**
   * Releases this material's own CPU state and its row in the material store
   *
   * That state is the packed {@link MaterialData}, the texture slots, and the cached descriptor
   * and pass overrides. Idempotent.
   *
   * Shared resources stay, as with pixi's `destroy`. With `texture` set, the material's textures
   * are destroyed too, except the engine's shared default textures; with `textureSource` as well,
   * each source behind them is destroyed once, however many textures share it. Compiled shaders
   * belong to the renderer and stay cached.
   * @param options - Teardown flags; `texture` destroys referenced textures and `textureSource`
   * widens that to their underlying sources. `textureSource` alone frees nothing.
   * @example
   * ```ts
   * mesh.material = new Material3D({ baseColor: 0x3366ff });
   * oldMaterial.destroy({ texture: true });
   * ```
   */
  public destroy(options?: TypeOrBool<TextureDestroyOptions>): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (resolveDestroy3DFlag(options, 'texture')) {
      const destroySource = resolveDestroy3DFlag(options, 'textureSource');
      const seenSources = destroySource ? new Set<TextureSource>() : undefined;
      for (const texture of this._textures) {
        if (!texture || SHARED_DEFAULT_TEXTURES.has(texture)) continue;
        if (seenSources) {
          const source = texture.source;
          texture.destroy(false);
          if (source && !seenSources.has(source)) {
            seenSources.add(source);
            source.destroy();
          }
        } else {
          texture.destroy(false);
        }
      }
    }

    this._uploadQueue?.remove(this);
    this._uploadQueue = null;
    this._storeQueued = false;

    (this.data as any) = undefined;
    (this.textures as any) = undefined;
    (this._textures as any) = undefined;
    (this._slotByName as any) = undefined;
    (this._descriptor as any) = undefined;
    (this._passes as any) = undefined;
    this._uvTransformRow0 = undefined;
    this._uvOffset = undefined;
  }
}
