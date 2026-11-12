import { BindGroup, Color, definedProps, Matrix, NOOP, State, Texture, warn } from 'pixi.js';
import type { BufferResource, ColorSource, TextureDestroyOptions, TextureSource, Topology, TypeOrBool } from 'pixi.js';

import { textureSetId } from '../core/batcher/textureSetId';
import { passBitRegistry } from '../core/render-passes/passBitRegistry';
import { RenderPassBit } from '../core/render-passes/RenderPass';
import { materialStructSnapshot, mergeMaterialStruct } from '../core/shader/codegen/materialStruct';
import type { ShaderBit } from '../core/shader/ShaderBit';
import { ShaderDescriptor } from '../core/shader/ShaderDescriptor';
import type { ShaderDescriptorOptions } from '../core/shader/ShaderDescriptor';
import { SHARED_DEFAULT_TEXTURES } from '../core/textures/DefaultTextures';
import type { Mesh3D } from '../scene/Mesh3D';
import type { View3D } from '../scene/View3D';
import { copyState } from '../utils/copyState';
import { resolveDestroy3DFlag } from '../utils/Destroy3DOptions';
import { UnstableList } from '../utils/UnstableList';
import { warnOnce } from '../utils/warnOnce';
import { normalizePassEntry } from './PassDescriptor';
import type { PassDescriptor, PassDescriptorOptions } from './PassDescriptor';
import { getOrCreateMaterialDataClass } from './utils/createMaterialDataClass';
import type { MaterialData } from './utils/createMaterialDataClass';
import { getOrCreateMaterialTexturesClass } from './utils/createMaterialTexturesClass';
import type { MaterialTextures } from './utils/createMaterialTexturesClass';
import { refreshBindGroup } from './utils/refreshBindGroup';
import { collectTextureNames } from './utils/validateMaterialTextureSlots';

/** @internal */
export interface MaterialUploadQueue {
  enqueueDirty(material: BaseMaterial3D): void;
  /** Reads the material's `data` for the length of its place, so call it before `data` is dropped */
  remove(material: BaseMaterial3D): void;
  uniformResource(material: BaseMaterial3D): BufferResource;
}

/**
 * Creates a render `State` with the defaults every material starts from: depth test on, blending
 * off, back-face culling on
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
 * - `'opaque'` (default): draws fully opaque, ignoring {@link BaseMaterial3D#alpha} and the alpha
 *   of textures and vertex colours. In an image pixi premultiplies, such as a PNG, a texel with
 *   alpha 0 draws black.
 * - `'mask'`: fragments with alpha below {@link BaseMaterial3D#alphaCutoff} are discarded
 * - `'blend'`: alpha-blended over what is behind it. Blended meshes draw back to front by each
 *   mesh's origin, not per triangle, so large or overlapping ones can draw in the wrong order.
 * @example
 * ```ts
 * const leaves = new Material3D({ baseColorTexture: leafTexture, alphaMode: 'mask' });
 * ```
 * @category materials
 * @standard
 */
export type AlphaMode = 'opaque' | 'mask' | 'blend';

/**
 * The colour space a material's shader does its colour maths in; see {@link BaseMaterial3D#colorSpace}
 *
 * - `'linear'` (default): decodes colours to linear light, works there, and encodes for display at
 *   the end. Lighting needs it.
 * - `'display'`: works on colours as authored, skipping the decode and the encode. Cheaper on phones,
 *   for an unlit material that only multiplies colours.
 * @example
 * ```ts
 * class MyStickerMaterial extends BaseMaterial3D {
 *   public override colorSpace: ColorSpace = 'display';
 *   public override lit = false;
 * }
 * ```
 * @category materials
 * @advanced
 */
export type ColorSpace = 'linear' | 'display';

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
   * Name for debugging and for finding the material; the glTF loader sets it to the name in the file
   * @example
   * ```ts
   * new Material3D({ label: 'Paint' });
   * ```
   */
  label?: string;
  /**
   * Base colour tint; the source's alpha is ignored, {@link BaseMaterial3DOptions#alpha} sets opacity
   * @example
   * ```ts
   * new Material3D({ baseColor: 0xff7733 });
   * ```
   */
  baseColor?: ColorSource;
  /**
   * Base opacity; `alphaMode: 'opaque'` ignores it
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
   * The bits' `textures` arrays decide which slots exist; this map only fills them. A slot left out
   * gets `Texture.WHITE`. A `baseColor` entry here wins over
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
   * {@link Material3D}, {@link PhongMaterial} and {@link FlatMaterial} each document where they sit
   * in their bit list; on a material built from a raw `descriptor`, as `ToonMaterial` and
   * `PortalMaterial` are, they follow its bits. A bit may declare material fields and textures;
   * fill its textures through the `textures` option, or later through
   * {@link BaseMaterial3D#textures}. A bit that uses `PI` or `INV_PI` lists
   * {@link mathConstantsBit} in its {@link ShaderBit#requires} rather than declaring them, and one that
   * calls `screenUVFromWorld` or `sampleScreenCopy` lists {@link screenSpaceFuncsBit}. To add bits to a
   * material that exists, such as one the glTF loader built, `material.clone({ extraBits })` makes a
   * copy with them and everything else the material has. For billboarding, set
   * {@link Mesh3D#billboardMode} instead.
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
   * Gives a faceted, low-poly look with no duplicated vertices, so one geometry can draw smooth or
   * faceted depending on its material. A normal map still applies on top. No visible effect on an
   * unlit material such as {@link FlatMaterial}. Fixed at construction.
   * @default false
   * @example
   * ```ts
   * new Material3D({ baseColor: 0x8a7f72, flatShading: true });
   * ```
   */
  flatShading?: boolean;
  /**
   * Whether the view's distance {@link View3D#fog | fog} may reach this material
   *
   * Turn it off for skyboxes, water and anything else with its own distance falloff; a sky dome
   * past the fog's far distance would turn flat fog colour. Fixed at construction.
   * @default true
   * @example
   * ```ts
   * new Material3D({ baseColorTexture: skyTexture, fog: false });
   * ```
   */
  fog?: boolean;
  /**
   * Whether a geometry's vertex colours (its `colors`) tint this material; see
   * {@link BaseMaterial3D#vertexColors}
   * @default false
   * @example
   * ```ts
   * new Material3D({ vertexColors: true });
   * ```
   */
  vertexColors?: boolean;

  /**
   * Shader bits for the material's main pass, for a custom material
   *
   * The material's textures and data are laid out from `bitsGpu`, so `bitsGl` must declare the same
   * texture names in the same order, or the constructor throws. A material whose bits change with
   * its settings overrides {@link BaseMaterial3D#getPrimaryDescriptor} instead.
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
   *   {@link PassDescriptor} says how these combine with the pass's own; they can't change later.
   * - `false`, or left out: don't draw in it. Useful for opting out of a pass that spread options
   *   or a subclass default turned on.
   *
   * A material can name a pass before the pass exists. A page has room for 24 custom pass names,
   * `'outline'` included, each taken the first time anything names it; a name past that joins
   * nothing, and a pass with it draws no meshes, without a warning.
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
   * UV transform for every texture of the material; see {@link BaseMaterial3D#uvTransform}
   *
   * Leave it out to let a framed (spritesheet) base colour texture set the transform.
   * @example
   * ```ts
   * new Material3D({ baseColorTexture: tileTexture, uvTransform: new Matrix().scale(4, 4) });
   * ```
   */
  uvTransform?: Matrix;
}

let UID = 0;

const IDENTITY_UV_ROW0 = new Float32Array([1, 0, 0, 1]);

/** Pixi's base `TextureSource` `uploadMethodId`, which render textures and `ContainerSource` don't override */
const GPU_ONLY_UPLOAD_METHOD = 'unknown';

function isFullFrame(texture: Texture): boolean {
  if (texture.rotate !== 0) return false;
  if (texture.noFrame) return true;
  const frame = texture.frame;
  return (
    frame.x === 0 && frame.y === 0 && frame.width === texture.source.width && frame.height === texture.source.height
  );
}

/**
 * Converts a display (sRGB) channel to linear light
 *
 * It uses a 2.2 gamma, the curve the shaders decode textures and encode their output with, rather
 * than the piecewise sRGB curve. Material colours you set as a `ColorSource` are display colours,
 * decoded with it.
 * @param channel - Display channel, from 0 to 1
 * @returns The linear-light channel value.
 * @category materials
 * @advanced
 */
export function srgbToLinear(channel: number): number {
  return Math.pow(channel, 2.2);
}

/**
 * Converts a linear-light channel to display (sRGB); the inverse of {@link srgbToLinear}
 * @param channel - Linear-light channel value.
 * @returns The display channel value.
 * @category materials
 * @advanced
 */
export function linearToSrgb(channel: number): number {
  return Math.pow(channel, 1 / 2.2);
}

/**
 * Writes a display colour's rgb into `target` at `offset` in linear light, times `scale`
 * @internal
 */
export function writeLinearRgb(target: Float32Array, offset: number, color: Color, scale = 1): void {
  target[offset] = srgbToLinear(color.red) * scale;
  target[offset + 1] = srgbToLinear(color.green) * scale;
  target[offset + 2] = srgbToLinear(color.blue) * scale;
}

/**
 * Adds a display colour's rgb to `target` at `offset` in linear light, times `scale`
 * @internal
 */
export function addLinearRgb(target: Float32Array, offset: number, color: Color, scale: number): void {
  target[offset] += srgbToLinear(color.red) * scale;
  target[offset + 1] += srgbToLinear(color.green) * scale;
  target[offset + 2] += srgbToLinear(color.blue) * scale;
}

/**
 * Whether `value` is an object literal, such as a feature group, rather than a texture, colour or
 * array, so `clone` merges it into the option it changes instead of replacing that
 * @param value - An option value
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/** Data fields the base sets from its own options, which `clone` leaves to those options rather than copying */
const BASE_OWNED_FIELDS = new Set(['baseColor', 'displayBaseColor', 'alphaCutoff', 'uvTransformRow0', 'uvOffset']);

/**
 * Base class for all 3D materials
 *
 * Holds what every material shares: base colour and alpha, the alpha mode, render state, texture
 * slots, a UV transform, and the data its shader reads. {@link Material3D}, {@link PhongMaterial}
 * and {@link FlatMaterial} build on it; a custom material passes its shader bits as `descriptor`.
 *
 * ## Sharing
 *
 * Many meshes can draw one material, and a change to it shows on all of them. A loaded model's
 * meshes draw its source's materials, shared with every model built from that source.
 * {@link BaseMaterial3D#clone} makes a copy of its own, with any constructor options changed, and
 * {@link Model3D#materials} gives one model copies to draw:
 * `model.materials = (material) => material.clone()`.
 *
 * ## Changing a material that has rendered
 *
 * Meshes pick up most changes on the next render: property setters, texture swaps, joining or
 * leaving a pass, and the view's `toneMapping`, `fog`, `environment` and `shadowFilter`. A few
 * need a call from you:
 *
 * - A {@link BatchedMesh3D} slot sees a texture swap, a new `alphaMode` or another change to the
 *   material's shader only after {@link BatchedMesh3D#invalidate}. A slot switching to or from
 *   `'blend'` also needs {@link BatchedMesh3D#setPassesAt} to move it between the opaque and
 *   transparent passes.
 * - After changing {@link BaseMaterial3D#colorSpace}, {@link BaseMaterial3D#vertexColors},
 *   {@link BaseMaterial3D#lit} or a field of {@link BaseMaterial3D#state}, call
 *   {@link Mesh3D#invalidate} on each mesh using the material.
 * - The `passes` overrides can't change; {@link BaseMaterial3D#clone | clone} the material with the new
 *   entry and assign the copy instead.
 * @example
 * ```ts
 * class MyGlowMaterial extends BaseMaterial3D {
 *   public override lit = false;
 *
 *   constructor(options: BaseMaterial3DOptions = {}) {
 *     super({ ...options, descriptor: { bitsGpu: [myGlowBit], bitsGl: [myGlowBit] } });
 *   }
 * }
 *
 * const orb = new Mesh3D({ geometry: new SphereGeometry(), material: new MyGlowMaterial() });
 * ```
 * @typeParam TData - Type of {@link BaseMaterial3D#data}, the material's struct fields.
 * @typeParam TTextures - Type of {@link BaseMaterial3D#textures}, the material's texture slots.
 * @typeParam TOptions - The class's constructor options, which {@link BaseMaterial3D#clone} takes.
 * A subclass with options of its own passes them here, and reads them back in `_toOptions`.
 * @category materials
 * @standard
 */
export class BaseMaterial3D<
  TData extends MaterialData = MaterialData,
  TTextures extends MaterialTextures = MaterialTextures,
  TOptions extends object = BaseMaterial3DOptions,
> {
  /** Built on first read of `EMPTY`, so importing the module builds nothing */
  private static _empty: BaseMaterial3D | null = null;

  /**
   * A shared material with no shader, which a {@link Mesh3D} holds until it's given a material
   *
   * A mesh on it draws nothing and compiles no shader, though its skeleton and morph targets still
   * upload. Assign it to a mesh's `material` to stop the mesh drawing; to hide a mesh for a
   * while, `visible = false` is cheaper. Don't give it to a {@link BatchedMesh3D} slot that's in a
   * pass, even a hidden one: such a slot needs a real material.
   *
   * Every waiting mesh shares it, so don't edit it. Its `destroy` does nothing, as with pixi's
   * `Texture.EMPTY`.
   * @example
   * ```ts
   * if (mesh.material === BaseMaterial3D.EMPTY) mesh.material = new Material3D();
   * ```
   * @advanced
   */
  public static get EMPTY(): BaseMaterial3D {
    return (BaseMaterial3D._empty ??= (() => {
      const empty = new BaseMaterial3D();
      empty.destroy = NOOP;
      return empty;
    })());
  }

  /**
   * Unique id for this material instance
   * @advanced
   */
  public uid = UID++;

  /**
   * Render state (blending, depth, culling) for every draw with this material
   *
   * `alphaMode` and `doubleSided` set parts of it. To change a field after the material has
   * rendered, see {@link BaseMaterial3D}. `polygonOffset` works on WebGL only; WebGPU ignores it.
   * @example
   * ```ts
   * // 'blend' draws it after the opaque meshes, so with no depth test it shows through them
   * const overlay = new FlatMaterial({ baseColor: 0xffcc00, alphaMode: 'blend' });
   * overlay.state.depthTest = false;
   * ```
   */
  public state: State;

  /** Whether `destroy()` has run */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only state
  public destroyed = false;

  /**
   * Primitive topology for every pass that doesn't set its own; set by the
   * {@link BaseMaterial3DOptions#topology | topology} option, and {@link PassDescriptor} lists what overrides it
   */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only state
  public readonly topology?: Topology;

  /**
   * Every texture, in the order the shader numbers its samplers; `validateMaterialTextureSlots` checks it
   * @internal
   */
  public _textures: Texture[] = [];

  /**
   * The `DrawCommandList.captureTick` that last captured these textures, so a build captures them once
   * @internal
   */
  public _captureTick = -1;

  /** @internal */
  public _slotByName: Record<string, number> = Object.create(null);

  private _bindGroup: BindGroup | null = null;

  private _mergedBindGroup: BindGroup | null = null;

  /**
   * From `textureSetId`: equal on materials that bind the same sources in slot order
   * @internal
   */
  public _textureSetId = 0;

  private readonly _baseColorLinear = new Float32Array([1, 1, 1]);
  private _baseColorTint = 0xffffff;
  private _alpha = 1;
  private _alphaCutoff: number = 0.5;
  protected _alphaMode: AlphaMode = 'opaque';

  /**
   * The passes the material draws in, read live by meshes; joining one goes through
   * `_markDescriptorDirty` so a joining mesh builds its pass cache that frame; leaving one only queues meshes
   * @internal
   */
  public _passBit: number = RenderPassBit.OPAQUE;

  /**
   * The scene meshes drawing this material; batch slots aren't listed
   * @internal
   */
  public readonly _meshes = new UnstableList<Mesh3D>('_materialMeshIndex');

  /**
   * First texel of the material's place in its store, `-1` while it has none
   * @internal
   */
  public _materialIndex = -1;

  /** @internal */
  public _lastTextureDirtyId = -1;

  /**
   * The store's `BufferResource` over the material's place, `null` until the store makes one; `unload`
   * keeps it, as it keeps the place
   * @internal
   */
  public _uniformResource: BufferResource | null = null;

  /**
   * Each mesh compares it with its `_lastDescriptorDirtyId`; bump it only through `_markDescriptorDirty`
   * @internal
   */
  public _descriptorDirtyId = 0;

  /** Whether back faces are drawn too, lit with their normal flipped; set by the `doubleSided` option */
  // oxlint-disable-next-line pixijs-3d/require-standard-example -- read-only state
  public readonly doubleSided: boolean;

  /**
   * Set on a material whose colour already went through the view's curve, such as a portal's; it
   * takes the display encode alone
   * @internal
   */
  public _skipsToneCurve = false;

  /**
   * The colour space this material's shader works in; see {@link ColorSpace}
   *
   * `'display'` takes effect only on an unlit material, in a view with `toneMapping: 'none'` and no
   * enabled `'beforeToneMapping'` effect, on a mesh no fog or vertex colours reach. Anywhere else
   * the shader works in linear light. To change it after the material has rendered, see
   * {@link BaseMaterial3D}.
   *
   * Bits on a `'display'` material should read colours through these helpers, which exist in both
   * shader stages and return the colour in the shader's space:
   *
   * - `decodeColor(c: vec3)`: a display colour, such as a texture sample.
   * - `inputTint(linearTint: vec4, displayTint: vec4)`: pass `material.baseColor` and
   *   `material.displayBaseColor`, which the material fills once a bit declares them in
   *   `bindings.material`.
   * - `decodeFrame(c: vec3)`: a colour from a frame this view drew, such as a render-texture feed.
   *
   * Multiplying colours read this way gives the same bytes in both spaces. Adding, blending or
   * scaling them by a number doesn't, so the result changes when fog moves the shader to linear
   * light. On the display path, a {@link SceneOutput} bit that reads `albedo` sees display colours.
   * @default 'linear'
   * @example
   * ```ts
   * class MyStickerMaterial extends BaseMaterial3D {
   *   public override colorSpace: ColorSpace = 'display';
   *   public override lit = false;
   * }
   * ```
   * @advanced
   */
  public colorSpace: ColorSpace = 'linear';

  /**
   * Whether the view's {@link View3D#fog | fog} may reach this material; set by the
   * {@link BaseMaterial3DOptions#fog | fog} option
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
   * Off by default, since exporters often fill the colour set with masks or weights; put data that
   * isn't colour in {@link Geometry3DOptions#colors1 | colors1} when you can. The glTF loader turns
   * it on, as glTF's `COLOR_0` is a base colour multiplier in linear light; convert colours picked
   * in sRGB with {@link srgbToLinear}. To change it after the material has rendered, see
   * {@link BaseMaterial3D}.
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
   * Set it to `false` for a shader that does none, as {@link FlatMaterial} does. That leaves out
   * `calculateShadow`, so a shader that calls it fails to compile. To change it after the material
   * has rendered, see {@link BaseMaterial3D}.
   * @default true
   * @example
   * ```ts
   * class MyUnlitMaterial extends BaseMaterial3D {
   *   public override lit = false;
   * }
   * ```
   */
  public lit = true;

  /**
   * Name for debugging and for finding the material, such as the glTF material name the loader
   * gives it; a {@link Model3DOptions#materials} record matches it
   * @example
   * ```ts
   * const paint = source.materials.filter((material) => material.label === 'Paint');
   * ```
   */
  public label?: string;

  /** `undefined` when the bits have no `uvTransformBit` */
  private _uvTransformRow0?: Float32Array;

  private _uvOffset?: Float32Array;

  private _uvTransformExplicit: boolean;

  private _uvTransform?: Matrix;

  private _initialUvTransform?: Matrix;

  /**
   * The construction bits' merged struct, which `validateMaterialStruct` holds every compiled shader
   * to; `'{}'` when it has no fields
   * @internal
   */
  public _materialStructSnapshot = '{}';

  /**
   * The values the material's shader reads, one property per field its bits declare; see
   * {@link MaterialData} for how they read and write
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
   * compiled shader, except that a real map in the `normal` slot, or the default put back, switches
   * normal mapping on or off.
   *
   * Wrap mode, filtering and anisotropy come from each texture's `source.style`, which clamps by
   * default. To tile a texture, set `texture.source.style.addressMode = 'repeat'`, then call
   * `style.update()`.
   * @example
   * ```ts
   * material.textures.baseColor = crateTexture;
   * ```
   */
  public textures!: TTextures;

  /**
   * The store the data uploads through, `null` until a mesh first draws the material and after `destroy`
   * @internal
   */
  public _uploadQueue: MaterialUploadQueue | null = null;

  /**
   * Whether the material waits in its store's upload queue
   * @internal
   */
  public _storeQueued = false;

  /**
   * Queues this material's data for upload
   *
   * Property setters and `data` field assignments call it for you. Call it yourself after writing
   * into a `data` vector in place. Calls in one frame upload once.
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
   * Whether `getPrimaryDescriptor` must rebuild its bit list; the override that rebuilds clears it
   * @internal
   */
  protected _variantDirty = true;

  /**
   * The `passes` overrides by pass bit, fixed at construction since each mesh resolves its entry only
   * when it builds its draw data
   * @internal
   */
  public _passes: Record<number, PassDescriptor> = {};

  /**
   * The shader bits this material was built with on top of its own, from the
   * {@link BaseMaterial3DOptions#extraBits | extraBits} option
   *
   * Fixed for the material's lifetime. {@link BaseMaterial3D#clone} makes a copy with more.
   * @example
   * ```ts
   * const dissolving = materials.filter((material) => material.extraBits.includes(dissolveBit));
   * ```
   * @advanced
   */
  public readonly extraBits: readonly ShaderBit[];

  /** The `descriptor` option as given, without the extra bits, for `_toOptions` to pass again */
  private readonly _descriptorOptions?: ShaderDescriptorOptions;

  /** @internal */
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
    this.label = options.label;
    this.vertexColors = options.vertexColors ?? false;
    this.extraBits = options.extraBits ?? [];

    this._uvTransformExplicit = !!options.uvTransform;
    this._initialUvTransform = options.uvTransform;

    if (options.descriptor) {
      const descriptor = (this._descriptorOptions = options.descriptor);
      const extra = this.extraBits;

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
            `[${gpuNames}]. Both backends bind from the same derived slots, so the sequences must match.`,
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
   * Texture `t` at `2t`, its style at `2t + 1`, then the row if the struct has fields (`materialBindingsBit`);
   * the row is re-fetched each call and bound unwatched, since the store destroys the one it replaces
   * @internal
   */
  public _getBindGroup(): BindGroup {
    let group = this._bindGroup;
    const textures = this._textures;

    if (!group) {
      group = this._bindGroup = new BindGroup();
      this._refreshTextureBindingsOf(group);
    }

    if (this._materialStructSnapshot !== '{}') {
      const queue = this._uploadQueue;
      if (!queue) {
        throw new Error(
          '[BaseMaterial3D] _getBindGroup on a material no store has registered; a mesh drawing it registers it first',
        );
      }
      const binding = textures.length * 2;
      const resource = queue.uniformResource(this);
      if (group.getResource(binding) !== resource) group.setResourceUnwatched(resource, binding);
    }

    return group;
  }

  /**
   * The textures of `_getBindGroup` with no row; a merged run binds its first material's group for
   * every material in it
   * @internal
   */
  public _getMergedBindGroup(): BindGroup {
    let group = this._mergedBindGroup;

    if (!group) {
      group = this._mergedBindGroup = new BindGroup();
      this._refreshTextureBindingsOf(group);
    }

    return group;
  }

  /**
   * Lays out `data` and `textures` from `bits`; a subclass that builds its own bits calls it once,
   * from its constructor
   *
   * `bits` must declare every material field and texture that
   * {@link BaseMaterial3D#getPrimaryDescriptor} can compile, such as the fields of
   * {@link uvTransformBit}, with the textures in the same order, or the shader is rejected when it's
   * built. `data` and `textures` are cast to `TData` and `TTextures` unchecked, so the type
   * arguments must match what the bits declare. A raw `descriptor` is laid out for you.
   * @param bits - The bits that declare the material's fields and textures
   * @param textures - Slot contents by texture name; the rest get `Texture.WHITE`
   * @throws If two bits declare the same texture name.
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
    const displayBaseColor = this.data.displayBaseColor;
    if (displayBaseColor) {
      for (let i = 0; i < 3; i++) displayBaseColor[i] = linearToSrgb(this._baseColorLinear[i]);
      displayBaseColor[3] = this._alpha;
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
    this._textureSetId = textureSetId(_textures);

    this._deriveUvFrame();
  }

  /**
   * Re-keys only when the source changes, since bind groups and sort keys follow the source, so an
   * atlas frame flip costs at most a UV data write
   * @internal
   */
  public _setTextureSlot(index: number, value: Texture): void {
    const prev = this._textures[index];
    if (prev === value) return;
    this._textures[index] = value;

    if (prev?.source !== value.source) {
      this._textureSetId = textureSetId(this._textures);
      this._releaseBindGroup();
      this._markDescriptorDirty();
    }

    if (index === this._slotByName.baseColor) {
      this._deriveUvFrame();
    } else if (this._uvTransformRow0 && !isFullFrame(value) && !this._frameMatchesTransform(value)) {
      warnOnce(
        'pixijs-3d-uv-frame-secondary',
        '[@pixi/3d] A framed texture landed in a non-baseColor slot but the material UV transform ' +
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
   * Adds this material to a custom render pass, such as an {@link OutlinePass}, as naming it `true`
   * in the `passes` option does
   *
   * Meshes using the material draw in the pass from the next render, except one that left it
   * through {@link Mesh3D#disablePass}. {@link BatchedMesh3D} slots take their passes from
   * {@link BatchedMesh3D#setPassesAt} instead. Overrides for the pass can only be given at
   * construction, and the {@link BaseMaterial3DOptions#passes | passes} option has the limit on
   * custom pass names.
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
   * Meshes using the material leave the pass on the next render, except one that joined it through
   * {@link Mesh3D#enablePass}. An override given for the pass in the `passes` option is kept, so
   * {@link BaseMaterial3D#enablePass} brings it back.
   * @param name - The pass's `name`, such as `'outline'`.
   * @example
   * ```ts
   * material.disablePass('outline');
   * ```
   */
  public disablePass(name: string): void {
    const bit = passBitRegistry.get(name);
    if (bit === undefined || (this._passBit & bit) === 0) return;
    this._passBit &= ~bit;
    const meshes = this._meshes.items;
    for (let i = 0; i < meshes.length; i++) meshes[i]._queueMeshUpdate();
  }

  private _markDescriptorDirty(): void {
    this._descriptorDirtyId++;
    const meshes = this._meshes.items;
    for (let i = 0; i < meshes.length; i++) meshes[i]._markBatchDirty();
  }

  /**
   * Makes every mesh using the material rebuild its shader; call it from a subclass setter that
   * changes what {@link BaseMaterial3D#getPrimaryDescriptor} returns
   */
  protected _invalidateDescriptor(): void {
    this._variantDirty = true;
    this._markDescriptorDirty();
  }

  /**
   * How the material treats alpha; see {@link AlphaMode}
   *
   * Setting it also sets the blending and depth writes of `state`. `'blend'` turns depth writes
   * off, and its meshes cast no shadow. On a material built from a raw `descriptor`, `'mask'`
   * discards only if the descriptor's bits include {@link alphaMaskBit}.
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
   * Sets the alpha mode
   * @param value - How alpha is treated
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
   * Takes any `ColorSource` in display (sRGB) space, like `Container.tint`. The source's alpha is
   * ignored; {@link BaseMaterial3D#alpha} is the opacity.
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
   * Sets the base colour tint
   * @param value - Display colour; its alpha is ignored
   */
  public set baseColor(value: ColorSource) {
    const colour = Color.shared.setValue(value);
    this._baseColorTint = colour.toNumber();
    writeLinearRgb(this._baseColorLinear, 0, colour);
    const packed = this.data?.baseColor;
    if (packed) {
      packed.set(this._baseColorLinear);
      const displayBaseColor = this.data.displayBaseColor;
      if (displayBaseColor) colour.toRgbArray(displayBaseColor);
      this.update();
    }
  }

  /**
   * Base opacity, from 0 to 1; `alphaMode: 'opaque'` ignores it
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
   * Sets the base opacity
   * @param value - From 0 (transparent) to 1 (opaque)
   */
  public set alpha(value: number) {
    if (this._alpha === value) return;
    this._alpha = value;
    const packed = this.data?.baseColor;
    if (packed) {
      packed[3] = value;
      const display = this.data.displayBaseColor;
      if (display) display[3] = value;
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
   * Sets the alpha cutoff
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
   * One transform, as glTF's `KHR_texture_transform` defines it, applies to every texture of the
   * material. Setting a matrix takes over from a framed (spritesheet) base colour texture, and a
   * framed texture assigned while it's set warns that its frame is ignored; setting `undefined`
   * hands it back. Either is a data write, never a shader rebuild. On a material whose bits lack
   * {@link uvTransformBit}, setting a matrix warns and does nothing.
   *
   * A UV `(u, v)` becomes `(a * u + b * v + tx, c * u + d * v + ty)`, transposed from pixi's
   * `Matrix.apply`, so `new Matrix().rotate(rotation).scale(sx, sy).translate(x, y)` gives the
   * `KHR_texture_transform` result for those values. The getter returns the material's own matrix;
   * changing it in place does nothing until you assign it again.
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
   * Sets the UV transform
   * @param m - The transform, or `undefined` to follow the base colour texture's frame
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
    this._uvTransformRow0[0] = m.a;
    this._uvTransformRow0[1] = m.b;
    this._uvTransformRow0[2] = m.c;
    this._uvTransformRow0[3] = m.d;
    this._uvOffset![0] = m.tx;
    this._uvOffset![1] = m.ty;

    this.update();
  }

  /**
   * Call after changing the base colour texture's frame in place; rounds to float32 so an unchanged
   * frame queues no upload
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
          'pixijs-3d-uv-frame-explicit',
          '[@pixi/3d] A framed baseColor texture was assigned but the material has an explicit ' +
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
          'pixijs-3d-uv-frame-trimmed',
          '[@pixi/3d] The baseColor texture is trimmed. Trims describe where a sprite quad shrank ' +
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
   * Makes a material of the same class that draws as this one does now, with the options you pass
   * changed
   *
   * `options` are the class's constructor options. `clone` reads this material's current values
   * back as those options, merges yours over them, and passes the result to the class's
   * constructor. An option left out, or set to `undefined`, keeps this material's value. One that
   * takes an object, such as a feature group or `passes`, is merged one level deep:
   * `emissive: { strength: 2 }` on a {@link Material3D} keeps its emissive colour. `descriptor` is
   * replaced whole. A group the material doesn't have, such as `clearcoat`, adds the feature.
   *
   * `extraBits` adds to this material's {@link BaseMaterial3D#extraBits}, skipping a bit it already
   * has. Fields a new bit declares start at 0 and its texture slots hold `Texture.WHITE`, so set
   * them on the copy. The fields of the extra bits it already had keep their values.
   *
   * A raw-`descriptor` material, or any class that inherits `BaseMaterial3D`'s `_toOptions`
   * unchanged, keeps every field value and texture it has, except those an option you pass sets.
   *
   * What isn't an option comes across too: `colorSpace`, `lit`, the passes joined with
   * {@link BaseMaterial3D#enablePass}, and `state` with any change made through it, except the
   * flags an option you pass sets, such as `alphaMode`'s blending. Colour options read back as
   * 8-bit hex, as their getters return them.
   *
   * Textures are shared, not copied. Everything else belongs to the copy: assign it to meshes and
   * `destroy()` it when you're done, which leaves the shared textures alive. Materials with the same
   * bits share compiled shaders, so a copy compiles nothing new unless its bits are new.
   * @param options - Constructor options to change on the copy; left out, it's a plain copy.
   * @returns The copy, of the same class.
   * @example
   * ```ts
   * const dissolving = mesh.material.clone({ extraBits: [dissolveBit] });
   * dissolving.data.dissolve = 0.5;
   * mesh.material = dissolving;
   *
   * const ghost = mesh.material.clone({ alphaMode: 'blend', alpha: 0.4 });
   * ```
   */
  public clone(options?: TOptions): this {
    const merged = this._toOptions() as Record<string, unknown>;
    const overrides: BaseMaterial3DOptions = definedProps(options ?? {});

    for (const [key, value] of Object.entries(overrides)) {
      const current = merged[key];
      merged[key] =
        key !== 'descriptor' && isPlainObject(value) && isPlainObject(current)
          ? { ...current, ...definedProps(value) }
          : value;
    }

    const extraBits = this.extraBits;
    const added = overrides.extraBits?.filter((bit) => !extraBits.some((own) => own.name === bit.name)) ?? [];
    merged.extraBits = [...extraBits, ...added];

    const copy = new (this.constructor as new (options: object) => this)(merged);
    const data = copy.data as MaterialData;

    if (this._toOptions === BaseMaterial3D.prototype._toOptions) {
      for (const name of Object.keys(Object.getPrototypeOf(this.data))) {
        if (!BASE_OWNED_FIELDS.has(name) && name in data) data[name] = this.data[name];
      }

      const textures = overrides.textures ?? {};
      for (const name in this._slotByName) {
        const index = copy._slotByName[name];
        const named = name === 'baseColor' ? (overrides.baseColorTexture ?? textures.baseColor) : textures[name];
        if (index !== undefined && named === undefined) {
          copy._setTextureSlot(index, this._textures[this._slotByName[name]]);
        }
      }
    } else {
      for (const bit of extraBits) {
        for (const name in bit.bindings?.material) data[name] = this.data[name];
      }
    }

    const state = copy.state;
    const { blend, depthMask, culling, blendMode } = state;

    copyState(state, this.state);

    if ('alphaMode' in overrides) {
      state.blend = blend;
      state.depthMask = depthMask;
    }
    if ('doubleSided' in overrides) state.culling = culling;
    if ('blendMode' in overrides) state.blendMode = blendMode;

    copy.colorSpace = this.colorSpace;
    copy.lit = this.lit;

    return copy;
  }

  /**
   * This material's current values as its constructor's options, for {@link BaseMaterial3D#clone}
   *
   * The base reads back its own options, the texture slots of its `extraBits` as `textures`, and
   * the custom passes it's in as `passes`. While a class keeps this method, `clone` copies every
   * other field and texture slot onto the copy after building it. A subclass with options of its
   * own overrides this and adds them to `super`'s. `clone` then copies only the `extraBits` fields,
   * so the override has to read back every value and texture its constructor sets.
   * @returns Options that build a material like this one.
   * @advanced
   */
  protected _toOptions(): TOptions {
    const passes: NonNullable<BaseMaterial3DOptions['passes']> = {};
    for (let custom = this._passBit & ~RenderPassBit.MATERIAL_PASS_MASK; custom; custom &= custom - 1) {
      const bit = custom & -custom;
      const name = passBitRegistry.nameOf(bit);
      if (name) passes[name] = this._passes[bit] ?? true;
    }

    const textures: Record<string, Texture> = {};
    for (const name of collectTextureNames(this.extraBits)) textures[name] = this._textures[this._slotByName[name]];

    const options: BaseMaterial3DOptions = {
      label: this.label,
      descriptor: this._descriptorOptions,
      baseColor: this.baseColor,
      alpha: this.alpha,
      baseColorTexture: this._textures[this._slotByName.baseColor],
      textures,
      alphaMode: this.alphaMode,
      alphaCutoff: this.alphaCutoff,
      doubleSided: this.doubleSided,
      flatShading: this.flatShading,
      fog: this.fog,
      vertexColors: this.vertexColors,
      topology: this.topology,
      passes,
      uvTransform: this._uvTransformExplicit ? this.uvTransform : undefined,
    };

    return options as TOptions;
  }

  /**
   * Frees the GPU memory of this material's textures until a frame draws them again
   *
   * The next frame that draws the material re-uploads them from their CPU copies, so it keeps
   * drawing the same. Texture sources are shared, so every other material using one re-uploads it
   * too, as with `texture.source.unload()`. The engine's default textures are skipped, and so are
   * render textures and {@link ContainerTexture}s, whose pixels exist only on the GPU.
   *
   * Call {@link BatchedMesh3D#invalidate} for each batch slot that draws the material. Does nothing
   * once the material is destroyed.
   * @example
   * ```ts
   * view.root.removeChild(model);
   * material.unload(); // hand the texture memory back until the model is shown again
   * ```
   * @see {@link Model3D.unload} For giving back a whole model's geometry and textures at once.
   */
  public unload(): void {
    if (this.destroyed) return;

    this._releaseBindGroup();
    this._markDescriptorDirty();

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
   * Frees the material for good; a second call does nothing
   *
   * Its textures stay alive unless `options` asks for them. The engine's default textures are never
   * destroyed, and compiled shaders stay cached in the renderer.
   * @param options - `{ texture: true }` destroys the material's textures; add `textureSource: true`,
   * or pass `true`, to destroy their sources too
   * @example
   * ```ts
   * mesh.material = new Material3D({ baseColor: 0x3366ff });
   * oldMaterial.destroy({ texture: true });
   * ```
   */
  public destroy(options?: TypeOrBool<TextureDestroyOptions>): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this._releaseBindGroup();

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
    // oxlint-disable-next-line pixijs-3d/destroy-release -- a mesh still using the destroyed material removes itself from this list when it detaches or swaps material, and clear() resets its index so that remove is a no-op
    this._meshes.clear();
    this._uniformResource?.destroy(false);
    this._uniformResource = null;

    (this.data as TData | null) = null;
    (this.textures as TTextures | null) = null;
    (this._textures as Texture[] | null) = null;
    (this._slotByName as Record<string, number> | null) = null;
    this._descriptor = undefined;
    (this._passes as Record<number, PassDescriptor> | null) = null;
    this._uvTransformRow0 = undefined;
    this._uvOffset = undefined;
    (this._descriptorOptions as ShaderDescriptorOptions | null) = null;
  }

  /**
   * The bind groups hold their resources unwatched, since a listener per material on a shared texture
   * makes teardown N²; `DrawCommandList.refreshMaterialBindings` calls this once a texture changes
   * @internal
   */
  public _refreshTextureBindings(): void {
    if (this._bindGroup) this._refreshTextureBindingsOf(this._bindGroup);
    if (this._mergedBindGroup) this._refreshTextureBindingsOf(this._mergedBindGroup);
  }

  /**
   * Binds a destroyed source too, so the draw fails loudly rather than sampling the slot's previous
   * source; such a source has no style, so the previous style binding stays
   */
  private _refreshTextureBindingsOf(group: BindGroup): void {
    const textures = this._textures;
    for (let t = 0; t < textures.length; t++) {
      const source = textures[t].source;
      group.setResourceUnwatched(source, t * 2);
      if (source.style) group.setResourceUnwatched(source.style, t * 2 + 1);
    }
    refreshBindGroup(group);
  }

  /** Drops the groups without destroying them, since a draw command built earlier may still bind one */
  private _releaseBindGroup(): void {
    this._bindGroup = null;
    this._mergedBindGroup = null;
  }
}
