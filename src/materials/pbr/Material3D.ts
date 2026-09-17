import { Color } from 'pixi.js';
import type { ColorSource, Texture, TextureDestroyOptions, TypeOrBool } from 'pixi.js';

import { RenderPassBit } from '../../core/render-passes/RenderPass';
import { alphaMaskBit } from '../../core/shader/bits/alphaMaskBit';
import { anisotropyBit, anisotropyTextureBit } from '../../core/shader/bits/anisotropyBit';
import { emissiveBit } from '../../core/shader/bits/emissiveBit';
import { uvTransformBit } from '../../core/shader/bits/uvTransformBit';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import { ShaderDescriptor } from '../../core/shader/ShaderDescriptor';
import { NORMAL_MAP } from '../../core/textures/DefaultTextures';
import type { View3D } from '../../scene/View3D';
import { BaseMaterial3D, writeLinearRgb } from '../BaseMaterial3D';
import type { BaseMaterial3DOptions } from '../BaseMaterial3D';
import { createFeaturePropsClass } from '../utils/createFeaturePropsClass';
import type { MaterialData } from '../utils/createMaterialDataClass';
import type { MaterialTextures } from '../utils/createMaterialTexturesClass';
import { EmissivePropsClass } from '../utils/emissiveProps';
import type { EmissiveOptions, EmissiveProps } from '../utils/emissiveProps';
import { clearcoatBit, clearcoatNormalMapBit } from './bits/clearcoatBit';
import { iblBit } from './bits/iblBit';
import { iridescenceBit } from './bits/iridescenceBit';
import { pbrLightingBit } from './bits/pbrLightingBit';
import { pbrMaterialBit } from './bits/pbrMaterialBit';
import { screenSpaceFuncsBit } from './bits/screenSpaceFuncsBit';
import { sheenBit } from './bits/sheenBit';
import { specularBit } from './bits/specularBit';
import { transmissionBit } from './bits/transmissionBit';

/**
 * KHR_materials_specular — dielectric F0 strength and tint
 *
 * The spec defines `specularTexture` (A = factor) and `specularColorTexture`
 * (RGB = tint, sRGB) as separate bindings, but authored assets pack them into
 * one RGBA image. pixi-3d uses a single texture slot; when both are supplied
 * the colour texture wins (its alpha drives the factor). The glTF loader
 * warns on genuinely distinct textures.
 * @category materials
 * @standard
 */
export interface SpecularOptions {
  /**
   * Dielectric lobe strength
   * @default 1
   */
  factor?: number;
  /**
   * F0 tint (RGB)
   * @default 0xffffff
   */
  color?: ColorSource;
  /** A = factor mask */
  texture?: Texture;
  /** RGB = tint (sRGB); preferred for the packed slot */
  colorTexture?: Texture;
}

/**
 * KHR_materials_iridescence — thin-film interference
 *
 * The spec defines `iridescenceTexture` (R = factor) and
 * `iridescenceThicknessTexture` (G = thickness) as separate bindings, but
 * they are authored as a single packed RG image in every Khronos sample
 * asset. pixi-3d packs both into one slot (R = factor, G = thickness lerp
 * between min/max); when both are supplied the factor texture wins. The glTF
 * loader warns on genuinely distinct textures.
 * @category materials
 * @standard
 */
export interface IridescenceOptions {
  /**
   * Thin-film strength
   * @default 1
   */
  factor?: number;
  /**
   * Thin-film IOR
   * @default 1.3
   */
  ior?: number;
  /**
   * Thickness lerp endpoint at texture G = 0, in nm
   *
   * Defaults to 0 (no hue shift baseline); the glTF loader passes the spec default 100.
   */
  thicknessMinimum?: number;
  /**
   * Thickness lerp endpoint at texture G = 1, in nm
   * @default 400
   */
  thicknessMaximum?: number;
  /** R = factor mask; preferred for the packed slot */
  texture?: Texture;
  /** G = thickness */
  thicknessTexture?: Texture;
}

/**
 * KHR_materials_transmission + KHR_materials_volume (pixi-3d fuses the pair)
 * @category materials
 * @standard
 */
export interface TransmissionOptions {
  /**
   * Transmitted fraction (0 = opaque substrate, 1 = clear glass)
   * @default 1
   */
  factor?: number;
  /** R = transmitted-fraction mask */
  texture?: Texture;
  /**
   * Volume thickness in world units (0 = thin-walled)
   * @default 0
   */
  thickness?: number;
  /** G = thickness mask */
  thicknessTexture?: Texture;
  /** Beer–Lambert attenuation distance; defaults to effectively infinite */
  attenuationDistance?: number;
  /**
   * Attenuation tint
   * @default 0xffffff
   */
  attenuationColor?: ColorSource;
}

/**
 * KHR_materials_clearcoat — transparent lacquer layer with its own GGX lobe
 * @category materials
 * @standard
 */
export interface ClearcoatOptions {
  /**
   * Lacquer strength
   * @default 1
   */
  factor?: number;
  /**
   * Coat roughness, independent of base roughness
   * @default 0
   */
  roughness?: number;
  /**
   * Scale applied to the coat normal map's tangent-space xy
   * @default 1
   */
  normalScale?: number;
  /** R = coat factor mask */
  texture?: Texture;
  /** G = coat roughness mask */
  roughnessTexture?: Texture;
  /** Coat normal map; its presence selects the coat-normal shader variant, fixed at construction */
  normalTexture?: Texture;
}

/**
 * KHR_materials_sheen — grazing-angle fabric lobe
 *
 * The spec defines `sheenColorTexture` (RGB) and `sheenRoughnessTexture` (A)
 * as separate bindings, packed into one RGBA slot here; the colour texture
 * wins when both are supplied. The glTF loader warns on genuinely distinct
 * textures.
 * @category materials
 * @standard
 */
export interface SheenOptions {
  /**
   * Sheen tint — the whole lobe is multiplied by it
   * @default 0xffffff
   */
  color?: ColorSource;
  /**
   * Sheen roughness
   * @default 0
   */
  roughness?: number;
  /** RGB = colour, A = roughness; preferred for the packed slot */
  texture?: Texture;
  /** A = roughness */
  roughnessTexture?: Texture;
}

/**
 * KHR_materials_anisotropy — directional roughness for brushed-metal / carbon-fibre looks
 *
 * The optional `texture` packs the per-texel direction in RG (a [-1,1] vector
 * encoded to [0,1]) and the strength in B. Its presence selects the sampling
 * shader variant, so the texture is fixed at construction.
 * @category materials
 * @standard
 */
export interface AnisotropyOptions {
  /**
   * Anisotropy strength [0,1]
   * @default 1
   */
  strength?: number;
  /**
   * Rotation of the anisotropy direction, in radians
   * @default 0
   */
  rotation?: number;
  /** RG = direction, B = strength */
  texture?: Texture;
}

/**
 * Options for {@link Material3D}
 *
 * Core PBR fields are flat; extension features are per-feature option groups whose **presence
 * enables the feature** — `clearcoat: {}` opts in with defaults, absence leaves the material
 * paying nothing for it. Feature group defaults are "visibly on" (factor 1 / white): presence
 * signals intent. The glTF loader passes spec values explicitly, so file defaults are unaffected.
 * @category materials
 * @standard
 */
export interface Material3DOptions extends Omit<BaseMaterial3DOptions, 'textures' | 'descriptor'> {
  /**
   * Tangent-space normal map
   *
   * Defaults to a flat map encoding `(0, 0, 1)`, which makes the unconditional TBN sample a no-op.
   */
  normalTexture?: Texture;
  /**
   * Scalar bump-strength multiplier for the normal map
   * @default 1
   */
  normalScale?: number;

  /**
   * Perceptual roughness (0 = mirror, 1 = fully diffuse)
   * @default 1
   */
  roughness?: number;
  /**
   * Metalness (0 = dielectric, 1 = metal)
   * @default 0
   */
  metallic?: number;
  /** Packed metallic-roughness map (glTF layout: G = roughness, B = metallic) */
  metallicRoughnessTexture?: Texture;

  /** R = ambient occlusion */
  occlusionTexture?: Texture;
  /**
   * Occlusion map strength
   * @default 1
   */
  occlusionStrength?: number;

  /**
   * Index of refraction of the dielectric substrate (KHR_materials_ior) — a core scalar, not a
   * gated feature
   * @default 1.5
   */
  ior?: number;

  /** Emissive glow group; presence enables the feature */
  emissive?: EmissiveOptions;
  /** KHR_materials_specular group; presence enables the feature */
  specular?: SpecularOptions;
  /** KHR_materials_iridescence group; presence enables the feature */
  iridescence?: IridescenceOptions;
  /**
   * KHR_materials_transmission / volume group; presence enables the feature
   *
   * Also routes meshes using the material to the transmission pass.
   */
  transmission?: TransmissionOptions;
  /** KHR_materials_clearcoat group; presence enables the feature */
  clearcoat?: ClearcoatOptions;
  /** KHR_materials_sheen group; presence enables the feature */
  sheen?: SheenOptions;
  /** KHR_materials_anisotropy group; presence enables the feature */
  anisotropy?: AnisotropyOptions;
}

// --- Runtime feature props ---
// Each option group above has a runtime mirror: the constructor creates the
// props object only when the group was passed, so `material.clearcoat ===
// undefined` *is* the feature lock — there is nothing to mutate on a feature
// that wasn't compiled in. Value writes are free data syncs; colour props
// follow the `Container.tint` convention — set any display-space
// `ColorSource` (sRGB-decoded at write), get back the canonical hex
// number. The linear channel values live in `material.data`.

/**
 * Runtime specular props; present iff constructed with a `specular` group
 * @category materials
 * @standard
 */
export interface SpecularProps {
  /**
   * Dielectric lobe strength
   *
   * 1 matches standard PBR; 0 removes the dielectric reflection entirely. Metals are unaffected
   * — only the dielectric half of the Fresnel term is attenuated.
   */
  factor: number;
  /** F0 tint — set any display-space `ColorSource`, read back the canonical hex number */
  get color(): number;
  /** Sets the F0 tint from any display-space `ColorSource` */
  set color(value: ColorSource);
  /** Packed slot (RGB = tint, A = factor mask); see `specularBit.ts` */
  texture: Texture;
}

/**
 * Runtime iridescence props; present iff constructed with an `iridescence` group
 * @category materials
 * @standard
 */
export interface IridescenceProps {
  /** Thin-film strength (0 = off, 1 = full effect) */
  factor: number;
  /** Thin-film IOR */
  ior: number;
  /** Thickness lerp endpoint at texture G = 0, in nm */
  thicknessMinimum: number;
  /** Thickness lerp endpoint at texture G = 1, in nm */
  thicknessMaximum: number;
  /** Packed slot (R = factor mask, G = thickness lerp); see `iridescenceBit.ts` */
  texture: Texture;
}

/**
 * Runtime transmission + volume props; present iff constructed with a `transmission` group
 * @category materials
 * @standard
 */
export interface TransmissionProps {
  /** Transmitted fraction (0 = opaque substrate, 1 = clear glass) */
  factor: number;
  /** Volume thickness in world units (0 = thin-walled) */
  thickness: number;
  /** Beer–Lambert attenuation distance */
  attenuationDistance: number;
  /** Attenuation tint — set any display-space `ColorSource`, read back the canonical hex number */
  get attenuationColor(): number;
  /** Sets the attenuation tint from any display-space `ColorSource` */
  set attenuationColor(value: ColorSource);
  /** R = transmitted-fraction mask */
  texture: Texture;
  /** G = thickness mask */
  thicknessTexture: Texture;
}

/**
 * Runtime clearcoat props; present iff constructed with a `clearcoat` group
 * @category materials
 * @standard
 */
export interface ClearcoatProps {
  /** Lacquer strength (0 = none, 1 = full) */
  factor: number;
  /** Coat roughness, independent of base roughness */
  roughness: number;
  /** Scale applied to the coat normal map's tangent-space xy (no-op without a coat map) */
  normalScale: number;
  /** R = coat factor mask */
  texture: Texture;
  /** G = coat roughness mask */
  roughnessTexture: Texture;
  /**
   * The coat normal map, or `undefined` when built without one
   *
   * Fixed at construction — its presence selects the coat shader variant (no coat map skips the
   * TBN + sample) — so it is read-only; to add or change it, construct a new material.
   */
  readonly normalTexture?: Texture;
}

/**
 * Runtime sheen props; present iff constructed with a `sheen` group
 * @category materials
 * @standard
 */
export interface SheenProps {
  /** Sheen tint — set any display-space `ColorSource`, read back the canonical hex number */
  get color(): number;
  /** Sets the sheen tint from any display-space `ColorSource` */
  set color(value: ColorSource);
  /** Sheen roughness */
  roughness: number;
  /** Packed slot (RGB = colour, A = roughness); see `sheenBit.ts` */
  texture: Texture;
}

/**
 * Runtime anisotropy props; present iff constructed with an `anisotropy` group
 * @category materials
 * @standard
 */
export interface AnisotropyProps {
  /** Anisotropy strength [0,1] */
  strength: number;
  /** Rotation of the anisotropy direction, in radians */
  rotation: number;
  /**
   * The direction/strength map (RG = direction, B = strength), or `undefined` when built without one
   *
   * Its presence selects the sampling shader variant, so it is fixed at construction — read-only.
   */
  readonly texture?: Texture;
}

const SpecularPropsClass = createFeaturePropsClass<SpecularProps>({
  factor: { kind: 'lane', field: 'specularParams', lane: 3 },
  color: { kind: 'colour', field: 'specularParams' },
  texture: { kind: 'texture', slot: 'specular' },
});

// Iridescence rides shared vec4s: its factor packs into transmissionVolume.w
// and its IOR into attenuationColorIrid.w (both always present in the struct).
const IridescencePropsClass = createFeaturePropsClass<IridescenceProps>({
  factor: { kind: 'lane', field: 'transmissionVolume', lane: 3 },
  ior: { kind: 'lane', field: 'attenuationColorIrid', lane: 3 },
  thicknessMinimum: { kind: 'scalar', field: 'iridescenceThicknessMinimum' },
  thicknessMaximum: { kind: 'scalar', field: 'iridescenceThickness' },
  texture: { kind: 'texture', slot: 'iridescence' },
});

const TransmissionPropsClass = createFeaturePropsClass<TransmissionProps>({
  factor: { kind: 'lane', field: 'transmissionVolume', lane: 0 },
  thickness: { kind: 'lane', field: 'transmissionVolume', lane: 1 },
  attenuationDistance: { kind: 'lane', field: 'transmissionVolume', lane: 2 },
  attenuationColor: { kind: 'colour', field: 'attenuationColorIrid' },
  texture: { kind: 'texture', slot: 'transmission' },
  thicknessTexture: { kind: 'texture', slot: 'thickness' },
});

const ClearcoatPropsClass = createFeaturePropsClass<ClearcoatProps>({
  factor: { kind: 'lane', field: 'clearcoatParams', lane: 0 },
  roughness: { kind: 'lane', field: 'clearcoatParams', lane: 1 },
  normalScale: { kind: 'lane', field: 'clearcoatParams', lane: 2 },
  texture: { kind: 'texture', slot: 'clearcoat' },
  roughnessTexture: { kind: 'texture', slot: 'clearcoatRoughness' },
  // Read-only: the slot exists only on the coat-normal-map variant, and its
  // presence is fixed at construction (it selects the shader bit).
  normalTexture: { kind: 'texture', slot: 'clearcoatNormal', readonly: true },
});

const SheenPropsClass = createFeaturePropsClass<SheenProps>({
  color: { kind: 'colour', field: 'sheenParams' },
  roughness: { kind: 'lane', field: 'sheenParams', lane: 3 },
  texture: { kind: 'texture', slot: 'sheen' },
});

const AnisotropyPropsClass = createFeaturePropsClass<AnisotropyProps>({
  strength: { kind: 'lane', field: 'anisotropyParams', lane: 0 },
  rotation: { kind: 'lane', field: 'anisotropyParams', lane: 1 },
  // Read-only: the slot exists only on the texture variant, and its presence is
  // fixed at construction (it selects the shader bit).
  texture: { kind: 'texture', slot: 'anisotropy', readonly: true },
});

/**
 * The texture slots Material3D's derivation walk produces
 *
 * Same presence pattern as the feature props: core PBR slots always exist, extension slots iff
 * their group was constructed in. The optional slots' single-slot packing rules live on the
 * matching feature props docs.
 * @category materials
 * @standard
 */
export interface Material3DTextures extends MaterialTextures {
  /** Base colour (albedo) map */
  baseColor: Texture;
  /** G = roughness, B = metallic */
  metallicRoughness: Texture;
  /** R = ambient occlusion */
  occlusion: Texture;
  /** Tangent-space normal map */
  normal: Texture;
  /** Emissive map */
  emissive?: Texture;
  /** RGB = tint, A = factor */
  specular?: Texture;
  /** R = factor, G = thickness */
  iridescence?: Texture;
  /** R = transmitted fraction */
  transmission?: Texture;
  /** G = thickness */
  thickness?: Texture;
  /** R = coat factor */
  clearcoat?: Texture;
  /** G = coat roughness */
  clearcoatRoughness?: Texture;
  /** Coat normal map */
  clearcoatNormal?: Texture;
  /** RGB = colour, A = roughness */
  sheen?: Texture;
  /** RG = direction, B = strength */
  anisotropy?: Texture;
}

/**
 * The packed data shape Material3D's construction-determined struct produces
 *
 * Core PBR fields are always present (pbrMaterialBit declares them); extension fields exist iff
 * their feature group was constructed in. Typing `data` with it lets accessors and seeding read
 * fields without casts.
 * @category materials
 * @advanced
 */
export interface Material3DData extends MaterialData {
  /** Linear rgb, alpha in the last lane */
  baseColor: Float32Array;
  /** Lanes: metallic, roughness, occlusionStrength, ior */
  pbrParams: Float32Array;
  /** Bump-strength multiplier for the normal map */
  normalScale: number;
  /** Lanes: transmission factor, thickness, attenuationDistance, iridescence factor */
  transmissionVolume: Float32Array;
  /** Lanes: attenuationColor rgb, iridescence IOR */
  attenuationColorIrid: Float32Array;
  /** Linear emissive rgb */
  emissive?: Float32Array;
  /** Emissive intensity multiplier */
  emissiveStrength?: number;
  /** Thickness lerp endpoint at texture G = 1, in nm */
  iridescenceThickness?: number;
  /** Thickness lerp endpoint at texture G = 0, in nm */
  iridescenceThicknessMinimum?: number;
  /** Lanes: F0 tint rgb, factor */
  specularParams?: Float32Array;
  /** Lanes: factor, roughness, normalScale, unused */
  clearcoatParams?: Float32Array;
  /** Lanes: sheen colour rgb, roughness */
  sheenParams?: Float32Array;
  /** Lanes: strength, rotation, unused, unused */
  anisotropyParams?: Float32Array;
}

/**
 * A standard Physically Based Rendering (PBR) material
 *
 * Supports base color, metallic/roughness, emissive, normal, and occlusion maps,
 * as well as advanced PBR extensions like transmission, volume, and iridescence.
 *
 * Material properties live in {@link BaseMaterial3D#data} — the packed,
 * generated object mirroring the GPU `Material` struct. Core PBR scalars
 * (`metallic`, `roughness`, …) are flat accessors into it; each extension
 * feature exposes a runtime props object mirroring its option group
 * (`material.clearcoat.roughness`). Writes are free data syncs staged for
 * the next upload.
 *
 * ## Feature set is fixed at construction
 *
 * Extension features (emissive, specular, iridescence, transmission,
 * clearcoat, sheen) are locked in by the constructor options: each one
 * allocates its texture slots, struct fields, and shader bit up front, and
 * keeps them for the material's lifetime. Runtime writes to feature values
 * (`transmission.factor`, `iridescence.factor`, `clearcoat.factor`, …) are
 * free data syncs — never a shader recompile — and setting a value to 0
 * simply makes the feature contribute nothing. To add a feature a material
 * wasn't constructed with, create a new `Material3D` and assign it to the
 * mesh.
 *
 * Custom surface extensions compose via `extraBits` (see
 * {@link BaseMaterial3DOptions#extraBits}). They slot after the feature bits and before the
 * cutout test, so `material`-slot code sees the post-baseColor `albedo` / `alpha` and any
 * alpha it writes still reaches the cutout.
 * @category materials
 * @standard
 */
export class Material3D extends BaseMaterial3D<Material3DData, Material3DTextures> {
  // --- Runtime feature props, mirroring the construction option groups ---
  // Created only for the groups passed to the constructor; `undefined` is the
  // feature lock. Option shape = runtime shape:
  // `new Material3D({ clearcoat: { roughness: 0.2 } })` →
  // `material.clearcoat.roughness = 0.3`.
  /** Runtime emissive props; present iff constructed with an `emissive` group */
  public readonly emissive?: EmissiveProps;
  /** Runtime specular props; present iff constructed with a `specular` group */
  public readonly specular?: SpecularProps;
  /** Runtime iridescence props; present iff constructed with an `iridescence` group */
  public readonly iridescence?: IridescenceProps;
  /** Runtime transmission + volume props; present iff constructed with a `transmission` group */
  public readonly transmission?: TransmissionProps;
  /** Runtime clearcoat props; present iff constructed with a `clearcoat` group */
  public readonly clearcoat?: ClearcoatProps;
  /** Runtime sheen props; present iff constructed with a `sheen` group */
  public readonly sheen?: SheenProps;
  /** Runtime anisotropy props; present iff constructed with an `anisotropy` group */
  public readonly anisotropy?: AnisotropyProps;

  /**
   * Texture-bearing extension bits this material opted into at construction, in composition order
   *
   * The single ordering source: the constructor derives texture slots by walking
   * `[pbrMaterialBit, ...this._featureBits]` and {@link Material3D#getPrimaryDescriptor} splices
   * the same list into the shader bit list, so derived slots and compiled sample indices can't
   * disagree.
   *
   * Order is still semantic for the shader: specularBit must precede iridescenceBit (it rewrites
   * fresnelF0/f90, which iridescence reads as its baseF0 — the Khronos composition rule when
   * both extensions are present), and lobe bits execute in declaration order.
   */
  private readonly _featureBits: ShaderBit[] = [];

  constructor(options: Material3DOptions = {}) {
    const { emissive, specular, iridescence, transmission, clearcoat, sheen, anisotropy } = options;

    super({
      ...options,
      alphaMode: options.alphaMode ?? 'opaque',
      doubleSided: options.doubleSided ?? false,
    });

    if (transmission) {
      this._passBit = RenderPassBit.TRANSMISSION;
    }

    // Textures keyed by the names the bits declare in their `textures`
    // arrays; each enabled feature fills its own slots below. Unfilled names
    // fall back to WHITE (the identity multiplier) in `_deriveLayoutFromBits`;
    // normal-map slots default to the flat NORMAL_MAP (encodes (0,0,1)) so
    // the unconditional TBN sample is a no-op without an authored map.
    const textures: Record<string, Texture | undefined> = {
      baseColor: options.baseColorTexture,
      metallicRoughness: options.metallicRoughnessTexture,
      occlusion: options.occlusionTexture,
      normal: options.normalTexture ?? NORMAL_MAP,
    };

    // Presence of a feature group is the gate: each block fills its texture
    // slots and registers its bit — and the set never changes for the
    // material's lifetime. Group defaults are "visibly on" (factor 1 /
    // white) — opening the group signals intent; the glTF loader passes
    // spec values explicitly so file defaults are unaffected.
    if (emissive) {
      textures.emissive = emissive.texture;
      this._featureBits.push(emissiveBit);
    }

    if (specular) {
      // Single packed slot (RGB = tint, A = factor) — the colour texture wins.
      textures.specular = specular.colorTexture ?? specular.texture;
      this._featureBits.push(specularBit);
    }

    if (iridescence) {
      // Single packed slot (R = factor, G = thickness) — the factor texture wins.
      textures.iridescence = iridescence.texture ?? iridescence.thicknessTexture;
      this._featureBits.push(iridescenceBit);
    }

    if (transmission) {
      textures.transmission = transmission.texture;
      textures.thickness = transmission.thicknessTexture;
      this._featureBits.push(transmissionBit);
    }

    if (clearcoat) {
      textures.clearcoat = clearcoat.texture;
      textures.clearcoatRoughness = clearcoat.roughnessTexture;
      // Coat normal mapping is opt-in: only the with-normal-map variant samples
      // the coat normal + builds a TBN (and allocates the slot). Without it the
      // coat frame is the geometric normal — no TBN and no extra texture fetch.
      if (clearcoat.normalTexture) {
        textures.clearcoatNormal = clearcoat.normalTexture;
        this._featureBits.push(clearcoatNormalMapBit);
      } else {
        this._featureBits.push(clearcoatBit);
      }
    }

    if (sheen) {
      // Single packed slot (RGB = colour, A = roughness) — the colour texture wins.
      textures.sheen = sheen.texture ?? sheen.roughnessTexture;
      this._featureBits.push(sheenBit);
    }

    if (anisotropy) {
      // The direction/strength map is opt-in: only the texture variant samples it
      // (and allocates the slot). Without it the direction is a uniform (1,0).
      if (anisotropy.texture) {
        textures.anisotropy = anisotropy.texture;
        this._featureBits.push(anisotropyTextureBit);
      } else {
        this._featureBits.push(anisotropyBit);
      }
    }

    // Slot layout derives from the bits' own `textures` declarations — the
    // same walk texturesPluginGpu/Gl use to assign the shader's sample
    // indices, so the array and the compiled shader can't disagree. The map
    // above only supplies content for the names that walk produces.
    // uvTransformBit declares no textures but does declare struct fields —
    // it's unconditional, so the struct snapshot taken here always covers
    // everything the descriptor will compile.
    this._deriveLayoutFromBits([pbrMaterialBit, uvTransformBit, ...this._featureBits, ...this._extraBits], textures);

    // --- Seed the packed state ---
    // Derivation created `data` laid out as this material's struct; writes
    // land straight in upload memory, and `data` starts dirty so the seeds
    // reach the first frame without ceremony.
    const data = this.data;

    // Dielectric/plastic by default — the conventional engine baseline,
    // and what pbrMaterialBit also initialises its local `metallic` to.
    data.pbrParams[0] = options.metallic ?? 0;
    data.pbrParams[1] = options.roughness ?? 1;
    data.pbrParams[2] = options.occlusionStrength ?? 1;
    data.pbrParams[3] = options.ior ?? 1.5;
    data.normalScale = options.normalScale ?? 1;

    // Feature-off baselines for the always-present shared vecs. The lanes
    // are only read behind their feature's shader gate, but the upload
    // carries them regardless, so keep them deterministic (the zero-filled
    // buffer covers every other lane).
    data.transmissionVolume[2] = 1e10;
    const attenuationColorIrid = data.attenuationColorIrid;
    writeLinearRgb(attenuationColorIrid, 0, Color.shared.setValue(0xffffff));
    attenuationColorIrid[3] = 1.3;

    // Each present group gets its runtime props object, and seeds flow
    // through the same accessors runtime writes use. Group defaults are
    // "visibly on" (factor 1 / white) — opening the group signals intent;
    // the glTF loader passes spec values explicitly so file defaults are
    // unaffected. Texture slots were already filled by the derivation walk.
    if (emissive) {
      const props = (this.emissive = new EmissivePropsClass(this));
      props.color = emissive.color ?? 0xffffff;
      props.strength = emissive.strength ?? 1;
    }

    if (specular) {
      const props = (this.specular = new SpecularPropsClass(this));
      props.color = specular.color ?? 0xffffff;
      props.factor = specular.factor ?? 1;
    }

    if (iridescence) {
      const props = (this.iridescence = new IridescencePropsClass(this));
      props.factor = iridescence.factor ?? 1;
      props.ior = iridescence.ior ?? 1.3;
      props.thicknessMaximum = iridescence.thicknessMaximum ?? 400;
      // Spec default is 100 nm, but the presence default is a zero baseline
      // so a thickness texture sampling G=0 gives no hue shift. The glTF
      // loader passes 100 explicitly per spec.
      props.thicknessMinimum = iridescence.thicknessMinimum ?? 0;
    }

    if (transmission) {
      const props = (this.transmission = new TransmissionPropsClass(this));
      props.factor = transmission.factor ?? 1;
      props.thickness = transmission.thickness ?? 0;
      props.attenuationDistance = transmission.attenuationDistance ?? 1e10;
      props.attenuationColor = transmission.attenuationColor ?? 0xffffff;
    }

    if (clearcoat) {
      const props = (this.clearcoat = new ClearcoatPropsClass(this));
      props.factor = clearcoat.factor ?? 1;
      props.roughness = clearcoat.roughness ?? 0;
      props.normalScale = clearcoat.normalScale ?? 1;
    }

    if (sheen) {
      const props = (this.sheen = new SheenPropsClass(this));
      props.color = sheen.color ?? 0xffffff;
      props.roughness = sheen.roughness ?? 0;
    }

    if (anisotropy) {
      const props = (this.anisotropy = new AnisotropyPropsClass(this));
      props.strength = anisotropy.strength ?? 1;
      props.rotation = anisotropy.rotation ?? 0;
    }
  }

  /**
   * Descriptors cached per env-source bit name
   *
   * One entry per env kind (cube / hemisphere / default) seen across the views that render this
   * material — typically 1–3 entries. Reset whenever `_variantDirty` flips.
   *
   * Keying on the env-bit name (a structural signature) means multiple views sharing the same
   * env kind share one descriptor, and entries never leak per view.
   */
  private _descriptorByEnvKey: Record<string, ShaderDescriptor> = Object.create(null);

  /**
   * Builds the PBR shader descriptor for `view`, cached per env-source kind
   * @param view - The rendering view; its env-source bit keys the descriptor cache.
   * @returns The shader descriptor for the material's primary pass under the view's environment.
   */
  public override getPrimaryDescriptor(view: View3D): ShaderDescriptor {
    if (this._variantDirty) {
      this._descriptorByEnvKey = Object.create(null);
      this._variantDirty = false;
    }

    const envBit = view._envBit;
    const envKey = envBit.name;

    let descriptor = this._descriptorByEnvKey[envKey];
    if (descriptor) return descriptor;

    // envBit declares `sampleEnvironment` consumed by iblBit, clearcoatBit
    // and sheenBit. iblBit is the substrate's split-sum consumer and is
    // always present so the PBR ambient term flows through the env-source
    // contract regardless of which source the view picks. iblBit reflects the
    // specular env sample off `specularNormal` (pbrMaterialBit defaults it to the
    // normal; anisotropyBit overrides it with a bent normal) — no IBL variant.
    const bitsGpu = [pbrMaterialBit, envBit, iblBit];
    const bitsGl = [pbrMaterialBit, envBit, iblBit];

    bitsGpu.push(pbrLightingBit);
    bitsGl.push(pbrLightingBit);

    // screenSpaceFuncsBit is always present: it's a binding-less header-only
    // helper (`screenUVFromWorld`) with zero resource/layout footprint, and an
    // uncalled function is dead-code-eliminated. Including it unconditionally
    // means any feature that samples the opaque colour/depth copies (transmission
    // today, refraction/water/etc. tomorrow) can just call it — no need to gate
    // it per-feature, and no risk of the no-dedup duplicate-definition error.
    bitsGpu.push(screenSpaceFuncsBit);
    bitsGl.push(screenSpaceFuncsBit);

    bitsGpu.push(uvTransformBit);
    bitsGl.push(uvTransformBit);
    // The extension features locked at construction, spliced as one block so
    // the texture-bearing bit order always equals the constructor's slot
    // derivation (see `_featureBits` for the within-block ordering rule).
    // Each bit stays for the material's lifetime: a runtime
    // `emissive.color = 0x000000` or `transmission.factor = 0` just syncs
    // the value (shader contribution → 0, no recompile, no slot shift).
    bitsGpu.push(...this._featureBits);
    bitsGl.push(...this._featureBits);
    // User extension bits, after the features and before the cutout test —
    // mirroring the constructor's slot derivation order.
    bitsGpu.push(...this._extraBits);
    bitsGl.push(...this._extraBits);
    if (this._alphaMode === 'mask') {
      bitsGpu.push(alphaMaskBit);
      bitsGl.push(alphaMaskBit);
    }

    descriptor = new ShaderDescriptor({});
    descriptor.update({ bitsGpu, bitsGl });
    this._descriptorByEnvKey[envKey] = descriptor;
    return descriptor;
  }

  // --- Convenience getters/setters into struct backing arrays ---
  // `pbrParams` is float32, so the setters compare against the rounded value; a raw 0.3 never matches.

  /**
   * Metalness (0 = dielectric, 1 = metal)
   * @default 0
   */
  public get metallic(): number {
    return this.data.pbrParams[0];
  }
  /**
   * Sets the metalness, syncing the packed PBR params
   * @param value - Metalness from 0 (dielectric) to 1 (metal)
   */
  public set metallic(value: number) {
    if (this.data.pbrParams[0] === Math.fround(value)) return;
    this.data.pbrParams[0] = value;
    this.update();
  }

  /**
   * Perceptual roughness (0 = mirror, 1 = fully diffuse)
   * @default 1
   */
  public get roughness(): number {
    return this.data.pbrParams[1];
  }
  /**
   * Sets the perceptual roughness, syncing the packed PBR params
   * @param value - Roughness from 0 (mirror) to 1 (fully diffuse)
   */
  public set roughness(value: number) {
    if (this.data.pbrParams[1] === Math.fround(value)) return;
    this.data.pbrParams[1] = value;
    this.update();
  }

  /**
   * Occlusion map strength
   * @default 1
   */
  public get occlusionStrength(): number {
    return this.data.pbrParams[2];
  }
  /**
   * Sets the occlusion map strength, syncing the packed PBR params
   * @param value - Multiplier on the sampled occlusion that darkens ambient light
   */
  public set occlusionStrength(value: number) {
    if (this.data.pbrParams[2] === Math.fround(value)) return;
    this.data.pbrParams[2] = value;
    this.update();
  }

  /**
   * Index of refraction of the dielectric substrate (KHR_materials_ior)
   * @default 1.5
   */
  public get ior(): number {
    return this.data.pbrParams[3];
  }
  /**
   * Sets the substrate index of refraction, syncing the packed PBR params
   * @param value - Refractive index; 1.5 suits most glass and plastic
   */
  public set ior(value: number) {
    if (this.data.pbrParams[3] === Math.fround(value)) return;
    this.data.pbrParams[3] = value;
    this.update();
  }

  /**
   * Scalar bump-strength multiplier for the substrate normal map
   *
   * Mirrors glTF's `normalTextureInfo.scale`; 1 is a no-op.
   * @default 1
   */
  public get normalScale(): number {
    return this.data.normalScale;
  }
  /**
   * Sets the bump-strength multiplier for the substrate normal map (1 is a no-op)
   * @param value - Multiplier on the normal map's tangent-space xy
   */
  public set normalScale(value: number) {
    this.data.normalScale = value;
  }

  /**
   * Releases this material's owned CPU state, then the PBR-specific extras
   *
   * The extras are the per-env descriptor cache, the construction feature-bit list, and the
   * runtime feature-prop objects. Idempotent — `super.destroy` guards re-entry.
   * @param options - Teardown flags forwarded to {@link BaseMaterial3D#destroy}.
   */
  public override destroy(options?: TypeOrBool<TextureDestroyOptions>): void {
    if (this.destroyed) return;
    super.destroy(options);

    (this._descriptorByEnvKey as any) = null;
    this._featureBits.length = 0;

    /** Widened self view exposing the optional feature-prop slots as writable, for clearing @internal */
    const features = this as {
      emissive?: EmissiveProps;
      specular?: SpecularProps;
      iridescence?: IridescenceProps;
      transmission?: TransmissionProps;
      clearcoat?: ClearcoatProps;
      sheen?: SheenProps;
      anisotropy?: AnisotropyProps;
    };
    features.emissive = undefined;
    features.specular = undefined;
    features.iridescence = undefined;
    features.transmission = undefined;
    features.clearcoat = undefined;
    features.sheen = undefined;
    features.anisotropy = undefined;
  }
}
