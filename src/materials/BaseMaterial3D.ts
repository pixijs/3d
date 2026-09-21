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
 * The queue seam a registered material signals when its packed data changes
 *
 * Implemented by the pipe's material store (`MaterialDataStoreBuffer`), whose per-frame
 * `update()` drains the queue into staged rows before uploading. Materials know only this
 * interface.
 * @internal
 */
export interface MaterialUploadQueue {
  /** Queues the material's GPU row for re-upload on the next per-frame drain */
  enqueueDirty(material: BaseMaterial3D): void;
  /** Frees the material's row for reuse and resets its index — called from the material's `destroy` */
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
 * Alpha rendering mode, matching the glTF spec
 *
 * - `'opaque'`: fully opaque, alpha ignored (default)
 * - `'mask'`: alpha test against {@link BaseMaterial3D#alphaCutoff}
 * - `'blend'`: full alpha blending (transparent)
 * @category materials
 * @standard
 */
export type AlphaMode = 'opaque' | 'mask' | 'blend';

/**
 * Constructor options shared by every {@link BaseMaterial3D} subclass
 * @category materials
 * @standard
 */
export interface BaseMaterial3DOptions {
  /** Base colour tint (rgb); the source's alpha is ignored — opacity is {@link BaseMaterial3DOptions#alpha} */
  baseColor?: ColorSource;
  /**
   * Base opacity (the packed colour's alpha lane)
   * @default 1
   */
  alpha?: number;
  /**
   * Base colour (albedo) texture
   * @default Texture.WHITE
   */
  baseColorTexture?: Texture;

  /**
   * Name-keyed textures for materials constructed with a raw `descriptor`
   *
   * Keys are the texture names the descriptor's bits declare in their `textures` arrays; the
   * pack-order array (`_textures`) is derived by walking those declarations, so the bits — not
   * this map — decide slot layout. Names missing from the map fall back to `Texture.WHITE`.
   */
  textures?: Record<string, Texture | undefined>;

  /**
   * Extra shader bits composed into the material's primary shader, fixed for the material's
   * lifetime
   *
   * Where they sit in the bit list is each material's decision and is documented on that
   * material; a raw-`descriptor` material appends them after the descriptor's own bits on both
   * backends. Bits may declare struct fields and textures; texture declarations resolve from the
   * name-keyed {@link BaseMaterial3DOptions#textures | textures} option.
   *
   * Billboarding is *not* one of these: it's a vertex transform driven from
   * {@link Mesh3D#billboardMode} and injected by the material systems, so it composes with any
   * material rather than only one.
   */
  extraBits?: readonly ShaderBit[];

  /**
   * Alpha rendering mode (glTF spec)
   * @default 'opaque'
   */
  alphaMode?: AlphaMode;

  /**
   * Alpha cutoff for masked materials (glTF `"MASK"`)
   * @default 0.5
   */
  alphaCutoff?: number;

  /**
   * When `true`, disables back-face culling and enables double-sided lighting (normals are
   * flipped on back faces)
   *
   * Fixed at construction — not mutable at runtime; create a new material if you need to change
   * this.
   * @default false
   */
  doubleSided?: boolean;
  /**
   * When `true`, shades each triangle from its own face normal instead of the interpolated vertex
   * normal
   *
   * Gives the hard-edged, faceted look low-poly scenes are built around. The face normal is derived
   * per-fragment from screen-space derivatives, so one smooth-normalled mesh can be drawn either way
   * purely by material choice — no duplicated vertices, no second geometry.
   *
   * Applies to any material whose shader reads `normal`; it has no visible effect on one that
   * doesn't (see {@link FlatMaterial}). Composes with a normal map rather than replacing it — the
   * map perturbs the face normal.
   *
   * Fixed at construction — not mutable at runtime.
   * @default false
   */
  flatShading?: boolean;
  /**
   * Whether this material permits the View's distance fog to reach it
   *
   * A permission, not a statement of fact: fog applies only when the view has fog configured *and*
   * the material allows it. Leaving this `true` on a view with no fog does nothing.
   *
   * Set to `false` on skyboxes, water and anything else that owns its own distance falloff — a sky
   * dome sits past the fog's far field and would otherwise flatten to the fog colour.
   *
   * Fixed at construction — not mutable at runtime.
   * @default true
   */
  fog?: boolean;

  /**
   * The material's primary shader descriptor
   *
   * Defines which {@link ShaderBit}s are composed into the shader for this material's main render
   * pass (opaque, transparent, or transmission). For most custom materials this is the only
   * shader-related option needed. Pass the raw options object; it will be wrapped in a
   * {@link ShaderDescriptor} automatically.
   *
   * Materials with dynamic variants (e.g. bits that change at runtime based on property values)
   * should override `getPrimaryDescriptor()` instead.
   * @example
   * ```ts
   * new BaseMaterial3D({
   *   descriptor: { bitsGpu: [myBit], bitsGl: [myBit] },
   * });
   * ```
   */
  descriptor?: ShaderDescriptorOptions;

  /**
   * Custom render pass participation, keyed by the pass's `name` (the string passed to `RenderPass`)
   *
   * - `true` — participate, use the pass's default descriptor.
   * - options object — participate with a custom descriptor that may carry
   *   shader / state / topology overrides. Inner `shader` accepts either
   *   raw {@link ShaderDescriptorOptions} or a pre-built `ShaderDescriptor`.
   * - `false` (or absent) — don't participate. Useful for spreading options
   *   while explicitly opting out of a pass a parent/default would enable.
   *
   * Names are translated to bits via the global pass-bit registry, so a
   * material can be constructed before its passes are registered.
   * @example
   * ```ts
   * new ToonMaterial({
   *   descriptor: { bitsGpu: [toonBit], bitsGl: [toonBit] },
   *   passes: {
   *     outline: { shaderDescriptor: { overrides: { OUTLINE_WIDTH: 0.1 } } },
   *     // or simply: outline: true
   *     // or to opt out: outline: false
   *   },
   * });
   * ```
   */
  passes?: Record<string, PassDescriptorOptions | boolean>;

  /**
   * Overrides the geometry's primitive topology in every pass that doesn't itself set one
   *
   * Useful for line / point / debug materials drawn against any index buffer (caveat: a
   * triangle-list index buffer drawn as line-list yields triangle edges with 3x overdraw, not
   * "real" wireframe — author a wireframe geometry for clean output). Defaults to `undefined` —
   * the geometry's topology is used.
   */
  topology?: Topology;

  /**
   * Explicit 2D affine UV transform applied in the vertex shader (implements glTF `KHR_texture_transform`)
   *
   * Accepts a Pixi `Matrix` — any combination of `.scale()`, `.rotate()`, `.translate()` chains
   * works.
   *
   * Setting a matrix takes authorship of the transform: derivation from the baseColor texture's
   * frame is suspended until it's cleared (`material.uvTransform = undefined`). Leave unset to
   * let framed (spritesheet) baseColor textures apply automatically.
   */
  uvTransform?: Matrix;
}

let UID = 0;

/** Identity 2x2 block for a cleared / underived UV transform */
const IDENTITY_UV_ROW0 = new Float32Array([1, 0, 0, 1]);

/**
 * Whether a texture's frame covers its whole source with no packer rotation (nothing to honour)
 * @param texture - Texture whose frame and rotation are checked
 */
function isFullFrame(texture: Texture): boolean {
  // A GroupD8-rotated texture always carries a transform, whole-source or
  // not — same test as pixi's TextureMatrix.isSimple.
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
 * ## Cache invalidation
 *
 * Per-mesh per-pass render data (compiled shader, resolved state, resolved
 * topology, batch key) is cached on the mesh as `_passCache[bit]`. The cache
 * is rebuilt when the mesh's `_batchDirty` flag is set.
 *
 * **Auto-invalidating mutations (recommended path):**
 *
 * - `mesh.geometry = ...` / `mesh.material = ...` (the setters mark dirty)
 * - `mesh.invalidate()`
 * - `mesh.castShadow = ...` (joins/leaves the shadow pass)
 * - `material.alphaMode = ...` (calls `_invalidateDescriptor`)
 * - `material.enablePass(name)` (joins a custom pass)
 * - Swapping a texture slot to a different `TextureSource`
 * - Subclass calls to `_invalidateDescriptor` when shader-variant state changes
 *
 * Anything that changes which passes a material participates in **must** invalidate,
 * not merely may: pass membership is derived live (`Mesh3D.renderPassMask` reads
 * `material._passBit`), so a mesh becomes drawable in the new pass the moment the bit
 * flips. If `_passCache[bit]` isn't populated in the same breath, the batcher reads an
 * entry that was never built. Material-level changes reach every mesh via
 * `_descriptorDirtyId`, which each mesh watermarks independently — a shared flag would
 * be consumed by whichever mesh the scene loop reached first.
 *
 * **Batch slots are the exception.** {@link BatchedMesh3D} updates its slots from a
 * dirty list rather than a per-frame scan, so it only learns about changes you announce.
 * `setGeometryAt` / `setMaterialAt` announce themselves; mutating a material object that
 * slots already hold does not. Call {@link BatchedMesh3D#invalidate} per affected slot.
 * (Slot pass membership is declared via `setItemActive`, not derived, so the failure
 * there is a stale shader rather than a missing cache entry.)
 *
 * View-wide settings — `toneMapping`, `fog`, `environment`, `shadowFilter` — propagate
 * to everything automatically, batch slots included.
 *
 * **Live-by-reference mutations (no invalidation needed):**
 *
 * - `material.state.blend = ...` (and other `State` field mutations) — the
 *   cache stores `material.state` as a reference, and the renderer reads
 *   live values at submit time. Pipeline state is correct; only the cached
 *   `batchKey` is stale (may cause suboptimal batching).
 *
 * **`_passes` is construction-only — don't mutate at runtime.** Set per-pass
 * overrides via the `passes:` constructor option. Don't reach into
 * `material._passes[bit].state` (or `.shaderDescriptor`, `.topology`) and
 * change them after the material has rendered. Same for swapping in a new
 * `PassDescriptor`. Materials don't track their meshes, so changes can't
 * propagate automatically — to change overrides, build a new material and
 * assign it via `mesh.material = newMaterial`.
 *
 * `enablePass(name)` / `disablePass(name)` are runtime-safe — they only flip the
 * participation bit and don't touch `_passes`. `enablePass` invalidates (meshes need a
 * cache entry for the pass they just joined); `disablePass` doesn't need to — the stale
 * entry simply stops being read once the mesh drops out of that pass.
 *
 * Same construction-only invariant applies to subclass changes to
 * `getPrimaryDescriptor()` output (e.g. adding new shader bits): call
 * `_invalidateDescriptor` from the subclass setter that triggered the
 * change.
 * @category materials
 * @standard
 */
export class BaseMaterial3D<
  TData extends MaterialData = MaterialData,
  TTextures extends MaterialTextures = MaterialTextures,
> {
  /** Unique id for this material instance */
  public uid = UID++;

  /** GPU render state (blend, depth, culling) submitted with every draw that uses this material */
  public state: State;

  /** Whether `destroy()` has run — re-entry guard; mirrors pixi's `Container.destroyed` */
  public destroyed = false;

  /**
   * When set, this material's effective primitive topology in any pass that doesn't itself set one
   *
   * Sits between pass-level and geometry-level defaults in the resolution chain. Set once at
   * construction.
   */
  public readonly topology?: Topology;

  /**
   * Flat array of all textures used by this material, in pack order
   *
   * The batcher iterates it generically for texture extraction and slot packing; its length,
   * clamped to 15, feeds the sort key's texture-layout field to group materials by texture count,
   * reducing batcher switches.
   *
   * Derived — never hand-ordered. `_deriveLayoutFromBits` walks the material's texture-bearing
   * bits and pushes one slot per declared name, the same walk `texturesPluginGpu/Gl` use to
   * assign the compiled shader's sequential `sampleX` indices — so the array can't drift from
   * what the shader reads. `_slotByName` maps each declared name to its index.
   * @internal
   */
  public _textures: Texture[] = [];

  /**
   * Texture name → index into `_textures`, filled by `_deriveLayoutFromBits`
   *
   * Consumed by the name-keyed texture accessors and by `validateMaterialTextureSlots` at
   * shader-build time.
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
   * Cached render pass bit derived from `alphaMode`
   *
   * `RenderPassBit.OPAQUE` for opaque/mask, `RenderPassBit.TRANSPARENT` for blend. Used by
   * `Mesh3D.renderPassMask` to route meshes to the correct pass.
   * @internal
   */
  public _passBit: number = RenderPassBit.OPAQUE;

  /**
   * Index into the `MaterialDataStoreBuffer`
   *
   * Set when the material is first written to the buffer (`-1` = not yet registered). The
   * batcher writes this index into the per-instance store so the shader can look up material
   * properties (base colour factor, roughness, etc.).
   * @internal
   */
  public _materialIndex = -1;

  /**
   * Cached texture key derived from baseColor uid (`source.uid & 0xffff`)
   *
   * Set to -1 whenever a texture slot changes OR a shader variant changes (e.g.
   * transmission/iridescence toggling on/off, alphaMode switching to mask).
   *
   * Locality-preserving sort discriminator only — materials sharing the same albedo sort
   * adjacent, maximising texture-slot reuse in the batcher. It is memoised (rebuilt on first
   * read after invalidation), so it must NOT be used to signal per-mesh work: the first mesh to
   * re-read it consumes the -1 for every sibling sharing the material. Use `_descriptorDirtyId`
   * for that.
   * @internal
   */
  private _textureCacheKey = -1;

  /**
   * Monotonic counter bumped every time this material's shader variant or pass routing changes
   *
   * Each scene mesh records the version it last rebuilt against (`Mesh3D._lastDescriptorDirtyId`)
   * and compares independently, so EVERY mesh sharing this material rebuilds its `_passCache` —
   * not just whichever one the scene loop happened to reach first. User-batch slots aren't
   * walked, so they don't track this — `BatchedMesh3D.invalidate(index)` is their manual
   * equivalent.
   *
   * Same watermark pattern `updateView3DScene` already uses for `_lastRenderPass` and
   * `_lastWorldVisible`. Bump it only via `_markDescriptorDirty`.
   * @internal
   */
  public _descriptorDirtyId = 0;

  /**
   * When `true`, back-face culling is off and shading uses flipped normals on back faces
   *
   * Set only via {@link BaseMaterial3DOptions} at construction — not mutable at runtime (the
   * shader variant is chosen then; use a new material to change it).
   */
  public readonly doubleSided: boolean;

  /**
   * Whether the View's tone-mapping curve is applied to this material's output
   *
   * Override to `false` on unlit / overlay / gizmo materials.
   *
   * Treated like a shader-variant flag: changing it after first compile requires the owning
   * Mesh3D to flip `_batchDirty = true` to pick up the new variant. Most materials set this once
   * at construction and never touch it again.
   * @default true
   */
  public toneMapped = true;

  /**
   * Whether this material permits the View's distance fog to reach it — see
   * {@link BaseMaterial3DOptions.fog}
   *
   * Not to be confused with {@link View3D.fog}, which holds the fog *settings* for the whole view;
   * this only says whether those settings reach this material.
   *
   * Shader-variant flag, so it is fixed at construction: the compiled variant is chosen then, and
   * a later write would not reach the shader.
   */
  public readonly fog: boolean;

  /**
   * Whether to shade from face normals rather than interpolated vertex normals
   *
   * See {@link BaseMaterial3DOptions.flatShading}. The material system injects `flatShadingBit`
   * when this is set, positioned so the face normal replaces the interpolated one before any bit
   * reads it — including normal mapping, which then perturbs the face normal.
   *
   * Shader-variant flag — set at construction, not mutated at runtime.
   */
  public readonly flatShading: boolean;

  /**
   * Whether a geometry's `aColor` attribute tints this material
   *
   * Opt-in, because a color set is very often not a color. It is frequently the
   * only spare per-vertex channel an exporter offers, so pipelines fill it with
   * a wind stiffness mask, a texture blend weight, a baked occlusion term.
   * Multiplying albedo by any of those is wrong, so a material tints only when
   * it opts in.
   *
   * glTF is the exception: its spec does define `COLOR_0` as multiplying base
   * color, so the glTF loader turns this on for the materials it builds. Assets
   * loaded that way keep spec behaviour without hand-authored materials
   * inheriting a surprise.
   *
   * A second set arrives as `aColor1` and is never auto-consumed, so data
   * belongs there when the exporter allows it.
   *
   * Treated like a shader-variant flag: changing it after first compile requires the owning
   * Mesh3D to flip `_batchDirty = true` to pick up the new variant.
   * @default false
   */
  public vertexColors = false;

  /**
   * Whether this material's shader speaks the lighting contract
   *
   * The contract declares the `ambient` / `directLight` / `normal` accumulators that view-level
   * lighting bits (env fill, shadow sampling) write into. Override to `false` on materials whose
   * shader uses none of them (see {@link FlatMaterial}); the view-level bits are then skipped
   * entirely.
   *
   * Independent of *which* lighting model the material uses — that's the material's own concern.
   * This flag only says whether the shader participates in the contract at all.
   *
   * Shader-variant flag — set at construction, not mutated at runtime.
   * @default true
   */
  public lit = true;

  /**
   * Row-major 2x2 rotation-scale block of the UV transform — `[m00, m01, m10, m11]`
   *
   * Cached alias of `data.uvTransformRow0`, so the UV-transform write paths skip the generated
   * accessor. Wired at derivation for every bit list declaring the fields (all built-ins —
   * `uvTransformBit` is unconditional); absent only on raw descriptors whose bits never declare them.
   * @internal
   */
  private _uvTransformRow0?: Float32Array;

  /**
   * Translation component of the UV transform — `[tx, ty]`
   *
   * Cached alias of `data.uvOffset`, wired together with `_uvTransformRow0`.
   * @internal
   */
  private _uvOffset?: Float32Array;

  /**
   * Whether `uvTransform` currently holds a user-supplied matrix
   *
   * Explicit wins: while set, baseColor frame derivation is suspended (`_deriveUvFrame` warns on
   * a framed baseColor and leaves the values alone). Cleared by assigning
   * `uvTransform = undefined`.
   */
  private _uvTransformExplicit: boolean;

  private _uvTransform?: Matrix;

  /** Construction `uvTransform` value, applied once derivation wires the data views */
  private _initialUvTransform?: Matrix;

  /**
   * Snapshot of this material's canonical Material struct
   *
   * `mergeMaterialStruct` over the construction bits, set alongside texture derivation.
   * `validateMaterialStruct` compares the compiled shader's struct against it at build time.
   * @internal
   */
  public _materialStructSnapshot = '{}';

  /**
   * This material's GPU-synced state
   *
   * A generated object whose fields mirror the compiled Material struct exactly (see
   * {@link MaterialData}), created during construction-time derivation. Field writes are free
   * data syncs.
   *
   * The upload source: the store buffer stages a material by copying `data._f32` straight into
   * its slot.
   */
  public data!: TData;

  /**
   * Keyed runtime face of the texture slots, generated from the derivation walk
   *
   * The same names as the construction `textures:` option
   * (`material.textures.baseColor = tex`). Writes are cheap slot swaps (re-batch, never a
   * recompile); a typo'd name throws (sealed object).
   */
  public textures!: TTextures;

  /**
   * The upload queue this material signals when its packed data changes
   *
   * The pipe's material store, wired on first `register()` (first render encounter). Completes
   * the 1:1 slot commitment `_materialIndex` already makes: with the seam in hand, data
   * mutations self-enqueue instead of relying on a per-frame discovery walk. Re-wired on the
   * first encounter with another renderer's store; cleared by `destroy` so late `update()`
   * calls are no-ops.
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
   * Signals that this material's packed data changed, queueing its GPU row for re-upload
   *
   * The same contract as `Texture.update()` / `Buffer.update()`. Property setters call this
   * automatically; call it yourself only after mutating packed data directly (e.g. writing
   * through a `data` vector view in a hot loop). Repeat calls within a frame coalesce to one
   * upload. No-op before first render — registration captures earlier mutations in one full-row
   * copy.
   */
  public update(): void {
    this._uploadQueue?.enqueueDirty(this);
  }

  /**
   * Whether the cached `_descriptor` no longer reflects the material's current state
   *
   * Set when a variant-affecting property changes; the next `getPrimaryDescriptor()` call must
   * rebuild.
   * @internal
   */
  protected _variantDirty = true;

  /**
   * Pass descriptors keyed by render pass bit, populated from the constructor `passes` option
   * (resolved via the global pass-bit registry)
   *
   * The dispatch hot path reads `_passes[bit]` and falls through to `pass.descriptor` if absent.
   *
   * **Construction-only.** Set per-pass overrides via the `passes:` constructor option. Don't
   * mutate entries in this map at runtime — materials don't track their meshes, so changes
   * can't propagate automatically. To change an override, build a new material and assign it to
   * the mesh.
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

    // The UV transform fields are unconditional (uvTransformBit is in every
    // built-in bit list): identity by default, authored by the engine from
    // the baseColor texture's frame, or by an explicit matrix — which takes
    // authorship and suspends derivation. The backing views live in `data`,
    // so the initial matrix is applied when derivation wires them.
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

      // Raw-descriptor material: texture slots derive from the descriptor's
      // own bits. Both backends share the derived slots, so their bit lists
      // must declare the same texture names in the same order. An explicit
      // `textures.baseColor` entry wins over the convenience option.
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

    // Subclasses that assemble their own bits derive (and create `data`)
    // after super() returns; a bare no-descriptor material still gets an
    // empty data object so the dirty surface and upload copy stay total.
    this.data ??= new (getOrCreateMaterialDataClass({}, '{}'))(this) as TData;
  }

  /**
   * Locality sort key for the batcher, memoised from the first texture's source uid
   * @internal
   */
  get textureCacheKey() {
    if (this._textureCacheKey !== -1) return this._textureCacheKey;

    // First texture as a locality heuristic (it's the albedo on every
    // built-in material) — sorts same-albedo materials adjacent for the
    // batcher. Not semantic; custom materials group by whatever leads.
    this._textureCacheKey = this._textures.length > 0 ? this._textures[0].source.uid & 0xffff : 0;
    return this._textureCacheKey;
  }

  /**
   * Derives this material's entire GPU-facing layout from `bits`
   *
   * Two halves, both fixed here for the material's lifetime:
   *
   *  1. **The packed struct** — `mergeMaterialStruct(bits)` merges every bit's
   *     `bindings.material` into the canonical Material struct, snapshots it
   *     into `_materialStructSnapshot`, and instantiates `data` in that layout.
   *  2. **The texture slots** — walking `bits`' `textures` declarations in
   *     order builds `_textures`, `_slotByName`, and `textures`.
   *     `texturesPluginGpu/Gl` assign the compiled shader's sequential sample
   *     indices from the same walk, so the slots can't drift from what the
   *     shader reads. The `textures` argument supplies slot content by name;
   *     missing names fall back to `Texture.WHITE` (the identity multiplier).
   *
   * **`bits` must be exactly what `getPrimaryDescriptor()` will compile.** A
   * bit that contributes struct fields but is omitted here (or vice versa —
   * `uvTransformBit` declares no textures but two struct fields) makes the
   * snapshot disagree with the compiled shader, and `validateMaterialStruct`
   * rejects it at shader-build time.
   *
   * Subclasses that assemble their own bit lists call this from their
   * constructor; raw-`descriptor` materials are derived automatically. The
   * walked bit set is construction-fixed (feature pinning), matching the
   * construction-only rules elsewhere on this class.
   *
   * Throws on a duplicate texture name across bits — that composition would
   * also generate two `sampleX` functions and fail shader compilation, just
   * less legibly.
   * @param bits - The exact bit list the primary descriptor will compile.
   * @param textures - Slot content by declared texture name.
   */
  protected _deriveLayoutFromBits(
    bits: readonly ShaderBit[],
    textures: Record<string, Texture | undefined> = {},
  ): void {
    const _textures = this._textures;
    _textures.length = 0;

    this._slotByName = Object.create(null);

    // The same construction bit list also fixes this material's GPU struct:
    // snapshot the canonical merge so `validateMaterialStruct` can hold every
    // compiled variant to it, and instantiate the generated data object laid
    // out as that struct. Possible at all because struct-contributing bits
    // are construction-pinned.
    const structDef = mergeMaterialStruct(bits);
    this._materialStructSnapshot = materialStructSnapshot(structDef);
    // The one trust point between the generated class and the typed view of
    // it — subclasses declare what their construction-determined struct holds.
    this.data = new (getOrCreateMaterialDataClass(structDef, this._materialStructSnapshot))(this) as TData;

    // Seed the base-class fields the struct declares, and wire the UV
    // transform's public backing views straight into the packed data so the
    // setter writes land in upload memory.
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

    // Construction textures are placed by the walk above, not via
    // _setTextureSlot — run the frame derivation once they're all in.
    this._deriveUvFrame();
  }

  /**
   * Assigns one texture slot by index — the single runtime slot-write chokepoint the generated
   * `textures` accessors call
   *
   * Owns the generic slot semantics: identity early-out, batch-key reset, and frame derivation.
   * A swap itself never touches the packed row — textures bind via the batcher, and the one row
   * consequence a slot can have (the UV transform) queues its own upload from the derivation.
   * The construction-time bulk build in `_deriveLayoutFromBits` registers directly rather than
   * per slot.
   * @param index - Slot index into `_textures`.
   * @param value - The texture to place in the slot.
   * @internal
   */
  public _setTextureSlot(index: number, value: Texture): void {
    const prev = this._textures[index];
    if (prev === value) return;
    this._textures[index] = value;

    // Same-source swap (an atlas frame flip): every downstream key — batch
    // slot, bind-group hash, sort discriminator — derives from the
    // TextureSource uid, so bindings are byte-identical and no re-batch is
    // needed. Cross-source swaps re-key as before.
    if (prev?.source !== value.source) this._markDescriptorDirty();

    if (index === this._slotByName.baseColor) {
      this._deriveUvFrame();
    } else if (this._uvTransformRow0 && !isFullFrame(value) && !this._frameMatchesTransform(value)) {
      // The one transform is shared by every slot and derives from baseColor
      // only — a differently-framed secondary texture would silently sample
      // the whole atlas.
      warnOnce(
        'pixi3d-uv-frame-secondary',
        '[pixi-3d] A framed texture landed in a non-baseColor slot but the material UV transform ' +
          "(derived from the baseColor slot, or set explicitly) doesn't match its frame. The shared " +
          'transform cannot serve per-slot frames — pack secondary maps to match the baseColor frame.',
      );
    }
  }

  /**
   * Returns the primary pass descriptor
   *
   * Override to build it dynamically from current material properties. Receives the rendering
   * {@link View3D} so overrides can compose view-dependent bits (e.g. the env-source bit from
   * `view._envBit`). The base implementation ignores it and returns the cached descriptor.
   * @param _view - The view about to render this material.
   * @returns The shader descriptor for the material's primary pass.
   */
  public getPrimaryDescriptor(_view: View3D): ShaderDescriptor {
    return this._descriptor!;
  }

  /**
   * Adds this material to a custom render pass at runtime
   *
   * Equivalent to passing the name (with no override entry) in the constructor's `passes`
   * option, but callable after construction. Resolves the name → bit via the global registry
   * (auto-allocates if it's the first reference to that name).
   *
   * Only flips the participation bit. Per-material overrides (shader / state / topology) can
   * only be set via the constructor `passes:` option — this method intentionally doesn't accept
   * them because mutating `_passes` after first render won't propagate to live meshes.
   *
   * **Live meshes** rebuild automatically: joining a pass changes `Mesh3D.renderPassMask`, which
   * makes every mesh using this material drawable in the new pass immediately, so their
   * `_passCache[bit]` has to be populated in the same breath — otherwise the batcher reads an
   * entry that was never built. Batch slots are the exception, as ever: call
   * {@link BatchedMesh3D#invalidate} on each affected slot.
   * @param name - The pass's `name` (e.g. `'outline'`).
   */
  public enablePass(name: string): void {
    const prev = this._passBit;

    this._passBit |= passBitRegistry.getOrAllocate(name);
    if (this._passBit !== prev) this._markDescriptorDirty();
  }

  /**
   * Removes this material from a custom render pass at runtime
   *
   * The pass's descriptor in `_passes` is left intact; calling
   * {@link BaseMaterial3D#enablePass} again will resume participation with the same descriptor.
   * No-op if the name has never been registered.
   *
   * Runtime-safe — only flips the participation bit. Existing meshes drop out of the pass's
   * batch on the next frame (the `renderPassMask` check in `View3DPipe.update` excludes them).
   * The mesh's stale `_passCache[bit]` entry stays in memory but isn't read.
   * @param name - The pass's `name` (e.g. `'outline'`).
   */
  public disablePass(name: string): void {
    const bit = passBitRegistry.get(name);
    if (bit !== undefined) this._passBit &= ~bit;
  }

  /**
   * Invalidates the sort discriminator AND broadcasts to every mesh using this material
   *
   * Both must move together: `_textureCacheKey` is memoised, so on its own the first mesh to
   * re-read it swallows the signal and siblings keep a stale (or absent) `_passCache` — which
   * surfaces as an undefined pass cache in the batcher the moment pass routing changed too.
   *
   * Every `_textureCacheKey = -1` assignment goes through here.
   */
  private _markDescriptorDirty(): void {
    this._textureCacheKey = -1;
    this._descriptorDirtyId++;
  }

  /**
   * Marks the cached descriptor stale and broadcasts the variant change
   *
   * The next `getPrimaryDescriptor()` call rebuilds the descriptor, and View3DPipe picks up the
   * change on every mesh using this material and recompiles their shaders.
   */
  protected _invalidateDescriptor(): void {
    this._variantDirty = true;
    this._markDescriptorDirty();
  }

  /**
   * Controls how the material handles transparency (matches glTF spec)
   *
   * - `'opaque'` — Fully opaque, alpha channel is ignored.
   * - `'mask'`   — Hard alpha cutoff using {@link BaseMaterial3D#alphaCutoff}.
   * - `'blend'`  — Full alpha blending for transparent rendering.
   *
   * Changing this value automatically configures blending, depth writing, and render pass
   * routing so the material renders correctly.
   */
  get alphaMode(): AlphaMode {
    return this._alphaMode;
  }

  /**
   * Switches the transparency mode, reconfiguring blend/depth state, pass routing, and the shader variant
   * @param value - How alpha is treated: ignored, cut off, or blended
   */
  set alphaMode(value: AlphaMode) {
    if (this._alphaMode === value) return;
    this._alphaMode = value;
    const isBlend = value === 'blend';
    this.state.blend = isBlend;

    // Transparent meshes must not write depth — the transparent pass uses
    // depthReadOnly: true on its render target so the opaque depth buffer
    // can be sampled by effects. A pipeline that writes depth into a
    // read-only attachment would trigger a WebGPU validation error.
    this.state.depthMask = !isBlend;

    const coreMask = RenderPassBit.OPAQUE | RenderPassBit.TRANSPARENT;
    this._passBit = (this._passBit & ~coreMask) | (isBlend ? RenderPassBit.TRANSPARENT : RenderPassBit.OPAQUE);
    this.update();
    // Toggling 'mask' on/off adds/removes `alphaMaskBit` in subclass descriptors —
    // invalidate so getPrimaryDescriptor() rebuilds the bit list next access.
    this._invalidateDescriptor();
  }

  /**
   * Base colour tint (rgb)
   *
   * `Container.tint` semantics: set any `ColorSource` (display-space, sRGB-decoded to linear
   * light for the shader), read back the canonical hex number. The source's alpha is ignored —
   * opacity is {@link BaseMaterial3D#alpha}, exactly as tint and alpha are independent on a Pixi
   * container.
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
   * Base opacity — the alpha lane of the packed base colour
   * @default 1
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
   * Alpha cutoff threshold for `'mask'` alpha mode — fragments with alpha below it are discarded
   * @default 0.5
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
   * The explicit UV transform, or `undefined` while the engine derives it from the baseColor frame
   *
   * Implements glTF `KHR_texture_transform`. The transform is applied once in the vertex shader
   * and shared by every texture binding (base color, normal, occlusion, emissive, etc.) —
   * per-binding overrides are not supported.
   *
   * Assigning a matrix takes authorship: frame derivation is suspended (a framed baseColor
   * warns). Assigning `undefined` hands authorship back — the transform re-derives from whatever
   * texture sits in the baseColor slot. Runtime writes are pure data syncs — never a recompile.
   *
   * Mutating the returned Matrix in place (e.g. `material.uvTransform!.rotate(...)`) won't
   * update the GPU copy until the value is re-assigned.
   */
  public get uvTransform(): Matrix | undefined {
    return this._uvTransform;
  }

  /**
   * Assigns an explicit UV transform (taking authorship), or `undefined` to re-derive from the baseColor frame
   * @param m - Transform shared by every texture binding, or `undefined` to hand authorship back
   */
  public set uvTransform(m: Matrix | undefined) {
    // The descriptor's bits never declared the fields (a raw descriptor
    // without uvTransformBit) — nothing in the shader would read the values,
    // so there is nowhere to write them.
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
      // Hand authorship back to the engine: re-derive from the baseColor frame.
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
    // The shader reads row0 row-major as [m00 m01; m10 m11], i.e.
    //   tex_uv = (a*u + b*v + tx, c*u + d*v + ty)
    // This is the TRANSPOSE of Pixi's own column-major `Matrix.apply()`, and
    // intentionally so: the resulting affine matches the de-facto
    // KHR_texture_transform convention used by the glTF Sample Renderer
    // (visual CCW rotation in y-down UV space) when `m` is built via
    // `new Matrix().scale(sx, sy).rotate(rot).translate(ox, oy)` — the
    // shape used by the glTF loader.
    this._uvTransformRow0![0] = m.a;
    this._uvTransformRow0![1] = m.b;
    this._uvTransformRow0![2] = m.c;
    this._uvTransformRow0![3] = m.d;
    this._uvOffset![0] = m.tx;
    this._uvOffset![1] = m.ty;

    this.update();
  }

  /**
   * Engine-side UV-frame authorship: derives the shared UV transform from the baseColor slot's
   * texture frame — pixi's "the texture carries its frame" model applied to materials
   *
   * The frame quad's `uvs` corners give the affine exactly: the two edge vectors are the 2×2
   * columns (which encodes GroupD8 rotation with no special case) and the top-left corner is the
   * offset. An unframed texture (or no baseColor slot) resets to identity. An explicit
   * `uvTransform` suspends derivation entirely.
   *
   * Internal-public alongside `_setTextureSlot`: owners that edit a texture's frame in place
   * (see {@link Sprite3D}) get no slot write to hang the re-derivation off, so they call this
   * directly.
   * @internal
   */
  public _deriveUvFrame(): void {
    const row0 = this._uvTransformRow0;
    const offset = this._uvOffset;
    // Raw descriptor without uvTransformBit — the shader reads no transform.
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
      // uvs corners: (x0,y0) top-left, (x1,y1) top-right, (x3,y3) bottom-left.
      // Rounded to float32 up front so equality against the stored rows (f32
      // views) is exact — uv fractions like 1/3 don't survive the round-trip.
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
   * `texture.source.unload()` yourself. The engine's default textures (white, empty and flat
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

    // Distinct Texture wrappers can share one source; unloading it twice would tell every
    // draw build that captured it to rebuild twice over.
    const seenSources = new Set<TextureSource>();
    for (const texture of this._textures) {
      if (!texture || SHARED_DEFAULT_TEXTURES.has(texture)) continue;
      const source = texture.source;
      if (!source || seenSources.has(source)) continue;
      seenSources.add(source);
      // 'unknown' is the base TextureSource's upload method: no CPU resource, the pixels come
      // from being rendered to. Image, canvas, buffer, video and compressed sources re-upload.
      if (source.uploadMethodId === 'unknown') continue;
      source.unload();
    }
  }

  /**
   * Releases this material's exclusively-owned CPU state
   *
   * That state is the packed {@link MaterialData} ArrayBuffer, the texture slot array, and the
   * cached descriptor and pass overrides. Idempotent.
   *
   * Shared resources are kept by default, matching pixi's `destroy` contract. With `texture`
   * set, the material's textures are destroyed too — except the shared module-default textures
   * every material falls back to, which are never destroyed. Compiled shaders (owned by
   * `MaterialSystemGpu`) are never touched here; the material's store-buffer slot is released
   * back to its store for reuse.
   * @param options - Teardown flags; `texture` destroys referenced textures and `textureSource`
   * widens that to their underlying sources. `textureSource` alone frees nothing.
   */
  public destroy(options?: TypeOrBool<TextureDestroyOptions>): void {
    if (this.destroyed) return;
    this.destroyed = true;

    // `texture` is the gate, as in pixi's Sprite and Mesh: `textureSource` only widens it to the
    // sources behind those textures, so on its own it frees nothing.
    if (resolveDestroy3DFlag(options, 'texture')) {
      const destroySource = resolveDestroy3DFlag(options, 'textureSource');
      // Distinct Texture wrappers can share one TextureSource, and pixi's
      // TextureSource.destroy is not idempotent — free each source at most once.
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

    // Sever the queue seam: release the store row (recycled by the next
    // registered material) and drop the wiring. The drain drops any entry
    // already queued (it no longer names its store), so the queued flag is
    // closed out here; late update() calls no-op.
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
