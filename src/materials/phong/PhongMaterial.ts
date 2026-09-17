import { Color } from 'pixi.js';
import type { ColorSource, Texture, TextureDestroyOptions, TypeOrBool } from 'pixi.js';

import { alphaMaskBit } from '../../core/shader/bits/alphaMaskBit';
import { emissiveBit } from '../../core/shader/bits/emissiveBit';
import { uvTransformBit } from '../../core/shader/bits/uvTransformBit';
import type { ShaderBit } from '../../core/shader/ShaderBit';
import { ShaderDescriptor } from '../../core/shader/ShaderDescriptor';
import { NORMAL_MAP } from '../../core/textures/DefaultTextures';
import type { View3D } from '../../scene/View3D';
import { BaseMaterial3D, writeLinearRgb } from '../BaseMaterial3D';
import type { BaseMaterial3DOptions } from '../BaseMaterial3D';
import type { MaterialData } from '../utils/createMaterialDataClass';
import type { MaterialTextures } from '../utils/createMaterialTexturesClass';
import { EmissivePropsClass } from '../utils/emissiveProps';
import type { EmissiveOptions, EmissiveProps } from '../utils/emissiveProps';
import { phongLightingBit } from './bits/phongLightingBit';
import { phongMaterialBit } from './bits/phongMaterialBit';
import { phongSpecularTextureBit } from './bits/phongSpecularTextureBit';

/**
 * Options for {@link PhongMaterial}
 *
 * Core Blinn-Phong fields are flat; `emissive` is a gated feature group whose presence enables
 * the feature — the same shape as {@link Material3D}'s option groups.
 * @category materials
 * @standard
 */
export interface PhongMaterialOptions extends Omit<BaseMaterial3DOptions, 'descriptor'> {
  /**
   * Specular tint (rgb)
   *
   * The default is a restrained dielectric highlight. Fresnel lifts the tint toward white at
   * grazing angles, so a black tint doesn't remove the highlight —
   * {@link PhongMaterialOptions#specularStrength} does.
   * @default 0x111111
   */
  specularColor?: ColorSource;
  /**
   * Blinn-Phong specular exponent — higher is a tighter highlight
   * @default 30
   */
  shininess?: number;
  /**
   * Whole-lobe specular scale (Fresnel rim included) — 0 removes the highlight
   * @default 1
   */
  specularStrength?: number;
  /** Grayscale texture (red channel) modulating specular strength */
  specularTexture?: Texture;
  /** Tangent-space normal map; needs geometry UVs, and tangents are preferred */
  normalTexture?: Texture;
  /**
   * Normal-map tangent-space xy scale
   *
   * No-op without a normal map.
   * @default 1
   */
  normalScale?: number;
  /**
   * Self-illumination — colour, strength, and an optional map
   *
   * `strength` above 1 lifts past white for HDR/bloom. Runtime control via
   * {@link PhongMaterial#emissive}.
   */
  emissive?: EmissiveOptions;
}

/**
 * The packed data shape `phongMaterialBit` (plus the gated feature bits) produces
 *
 * `baseColor` / `specularColor` / `shininess` / `specularStrength` / `alphaCutoff` are always
 * present; the rest exist only on the matching feature variant.
 * @category materials
 * @advanced
 */
export interface PhongData extends MaterialData {
  /** Linear-light base colour */
  baseColor: Float32Array;
  /** Linear-light specular tint (rgb) */
  specularColor: Float32Array;
  /** Blinn-Phong specular exponent */
  shininess: number;
  /** Whole-lobe specular scale */
  specularStrength: number;
  /** Alpha-mask cutoff threshold */
  alphaCutoff: number;
  /** Normal-map tangent-space xy scale */
  normalScale: number;
  /** Linear-light emissive colour — present on the emissive feature variant */
  emissive?: Float32Array;
  /** Emissive strength multiplier — present on the emissive feature variant */
  emissiveStrength?: number;
}

/**
 * The texture slots PhongMaterial's derivation walk produces
 *
 * `baseColor` and `normal` always exist (the normal slot is reserved even without a map — the
 * pipe gates its sampling); `specular` / `emissive` exist iff their option was constructed in.
 * @category materials
 * @standard
 */
export interface PhongMaterialTextures extends MaterialTextures {
  /** Base colour map */
  baseColor: Texture;
  /** Tangent-space normal map — the slot is always reserved; sampling is gated on a real map */
  normal: Texture;
  /** Grayscale specular-strength map — present iff constructed with `specularTexture` */
  specular?: Texture;
  /** Emissive map — present iff constructed with the `emissive` group */
  emissive?: Texture;
}

/**
 * Blinn-Phong material
 *
 * A classic diffuse + specular surface model — cheaper than {@link Material3D}
 * and easy to art-direct. Diffuse is PI-normalized Lambert; specular is a
 * normalized half-vector highlight with a Fresnel-Schlick tint (see
 * `phongLightingBit`). It shares the
 * engine's PI / tone-mapping conventions, so a Phong mesh reads at the same
 * brightness as a PBR one under the same lights.
 *
 * Texture maps the material samples itself (specular, emissive) are
 * feature-gated: the bit and its texture slot exist only when that option is
 * supplied, so an untextured material samples nothing extra. The normal map
 * is pipe-gated instead — its slot is always reserved, and the sample + TBN
 * compile in only once a real map is assigned.
 *
 * Lit by direct lights, `AmbientLight`, and the view's `environment`: a
 * `Hemisphere` or cubemap contributes diffuse ambient through the env-source
 * contract — pure ALU for a hemisphere, a single roughest-mip fetch for a
 * cubemap. There is no specular environment response (highlights come from
 * direct lights only); use {@link Material3D} for reflective surfaces.
 *
 * Custom surface extensions compose via `extraBits` (see
 * {@link BaseMaterial3DOptions#extraBits}). They sit after the feature bits
 * and before `phongLightingBit`, so `material`-slot code sees the
 * post-base-colour `albedo` / `alpha` and `end`-slot code runs after lighting
 * but before the view's tone-mapping bit.
 * @example
 * ```ts
 * const material = new PhongMaterial({
 *   baseColor: 0x2f6f8b,
 *   specularColor: 0x777777,
 *   shininess: 48,
 * });
 * ```
 * @category materials
 * @standard
 */
export class PhongMaterial extends BaseMaterial3D<PhongData, PhongMaterialTextures> {
  /**
   * Runtime emissive props (`color` / `strength` / `texture`)
   *
   * Present iff constructed with the `emissive` group — absence is the feature lock, exactly as
   * on {@link Material3D}.
   */
  public readonly emissive?: EmissiveProps;

  /** Construction-fixed feature bits (specular texture / emissive) */
  private readonly _featureBits: ShaderBit[] = [];

  /** Canonical hex of the specular tint — `Container.tint`-style read-back */
  private _specularColorTint = 0x111111;

  constructor(options: PhongMaterialOptions = {}) {
    const { specularTexture, normalTexture, emissive } = options;

    super(options);

    // Maps the material samples itself (specular, emissive) are gated: no bit
    // means no fetch in the compiled shader. The normal slot is always
    // reserved — the pipe owns that sampling and already gates it on the slot
    // being a real map, so reserving costs nothing per fragment and keeps the
    // texture-count batch bucket stable across mapped/unmapped materials.
    // extraBits' own `textures` declarations resolve from the name-keyed
    // `textures` option, making texture-sampling extra bits first-class.
    const textures: Record<string, Texture | undefined> = {
      baseColor: options.baseColorTexture,
      normal: normalTexture ?? NORMAL_MAP,
      ...options.textures,
    };
    if (specularTexture) {
      textures.specular = specularTexture;
      this._featureBits.push(phongSpecularTextureBit);
    }
    if (emissive) {
      textures.emissive = emissive.texture;
      this._featureBits.push(emissiveBit);
    }

    // Must mirror the struct/slot-bearing bits of `getPrimaryDescriptor` (the
    // env-source bit joins there too, but is header-only — no struct fields,
    // no texture slots, so it stays out of the derivation). uvTransformBit
    // declares no textures but DOES declare struct fields — it's
    // unconditional, so the struct snapshot taken here always covers
    // everything the descriptor will compile.
    this._deriveLayoutFromBits([phongMaterialBit, uvTransformBit, ...this._featureBits, ...this._extraBits], textures);

    // Seed the packed state — writes land straight in upload memory.
    this.shininess = options.shininess ?? 30;
    this.specularStrength = options.specularStrength ?? 1;
    this.specularColor = options.specularColor ?? 0x111111;
    this.normalScale = options.normalScale ?? 1;
    if (emissive) {
      const props = (this.emissive = new EmissivePropsClass(this));
      props.color = emissive.color ?? 0xffffff;
      props.strength = emissive.strength ?? 1;
    }
  }

  /**
   * Descriptors cached per env-source bit name
   *
   * One entry per env kind (default / hemisphere / cube) seen across the views that render this
   * material; reset whenever `_variantDirty` flips. Same pattern as {@link Material3D}: keying on
   * the bit name lets views sharing an env kind share one descriptor, and entries never leak per
   * view.
   */
  private _descriptorByEnvKey: Record<string, ShaderDescriptor> = Object.create(null);

  /**
   * Builds (or returns the cached) primary-pass shader recipe for a view's environment kind
   * @param view - View whose environment source selects the descriptor variant
   * @returns The shader descriptor compiled for the primary pass
   */
  public override getPrimaryDescriptor(view: View3D): ShaderDescriptor {
    if (this._variantDirty) {
      this._descriptorByEnvKey = Object.create(null);
      this._variantDirty = false;
    }

    const envBit = view._envBit;
    let descriptor = this._descriptorByEnvKey[envBit.name];
    if (descriptor) return descriptor;

    // envBit provides `sampleEnvironment`, consumed by phongLightingBit's
    // ambient term. Header-only — it adds no struct fields or texture slots,
    // so the construction-derived layout holds across every env kind.
    const bits: ShaderBit[] = [phongMaterialBit, envBit, uvTransformBit];
    for (let i = 0; i < this._featureBits.length; i++) bits.push(this._featureBits[i]);
    for (let i = 0; i < this._extraBits.length; i++) bits.push(this._extraBits[i]);
    bits.push(phongLightingBit);
    if (this._alphaMode === 'mask') bits.push(alphaMaskBit);

    descriptor = new ShaderDescriptor({});
    descriptor.update({ bitsGpu: bits, bitsGl: bits });
    this._descriptorByEnvKey[envBit.name] = descriptor;
    return descriptor;
  }

  /** Blinn-Phong specular exponent — higher is a tighter highlight */
  public get shininess(): number {
    return this.data.shininess;
  }

  /**
   * Writes the exponent straight through to the packed material data
   * @param value - Specular exponent; higher values tighten the highlight
   */
  public set shininess(value: number) {
    this.data.shininess = value;
  }

  /**
   * Scales the whole specular lobe, Fresnel rim included — the dial to fade or kill the highlight
   *
   * `specularColor` alone can't remove it (Fresnel lifts any tint toward white at grazing angles,
   * so black still leaves a rim); 0 here truly does. The specular texture multiplies on top of
   * this.
   */
  public get specularStrength(): number {
    return this.data.specularStrength;
  }

  /**
   * Writes the multiplier straight through to the packed material data
   * @param value - Scale on the whole specular lobe; 0 removes the highlight
   */
  public set specularStrength(value: number) {
    this.data.specularStrength = value;
  }

  /**
   * Scalar bump-strength multiplier for the normal map
   *
   * Mirrors glTF's `normalTextureInfo.scale`. Default 1 is a no-op; so is any value while no
   * normal map is assigned.
   */
  public get normalScale(): number {
    return this.data.normalScale;
  }

  /**
   * Writes the multiplier straight through to the packed material data
   * @param value - Multiplier on the normal map's tangent-space xy; 1 is a no-op
   */
  public set normalScale(value: number) {
    this.data.normalScale = value;
  }

  /**
   * Specular tint (rgb)
   *
   * `Container.tint` semantics: set any {@link ColorSource} (sRGB-decoded to linear), read back
   * the canonical hex number.
   */
  public get specularColor(): number {
    return this._specularColorTint;
  }

  /**
   * Accepts any {@link ColorSource}; sRGB-decoded to linear before packing
   * @param value - Display-space specular tint
   */
  public set specularColor(value: ColorSource) {
    const colour = Color.shared.setValue(value);
    this._specularColorTint = colour.toNumber();
    const packed = this.data?.specularColor;
    if (packed) {
      writeLinearRgb(packed, 0, colour);
      this.update();
    }
  }

  /**
   * Releases this material's owned CPU state, then the per-env descriptor cache, the feature-bit
   * list, and the emissive props
   *
   * Idempotent.
   * @param options - Destroy options, forwarded to {@link BaseMaterial3D#destroy}
   */
  public override destroy(options?: TypeOrBool<TextureDestroyOptions>): void {
    if (this.destroyed) return;
    super.destroy(options);

    (this._descriptorByEnvKey as any) = null;
    this._featureBits.length = 0;
    (this as { /** @internal */ emissive?: EmissiveProps }).emissive = undefined;
  }
}
