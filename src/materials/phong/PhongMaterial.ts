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
 * Passing the `emissive` group turns the glow on, as on {@link Material3D}.
 * @example
 * ```ts
 * const options: PhongMaterialOptions = { baseColor: 0x8a5a2b, shininess: 12 };
 * const wood = new PhongMaterial(options);
 * ```
 * @category materials
 * @standard
 */
export interface PhongMaterialOptions extends Omit<BaseMaterial3DOptions, 'descriptor'> {
  /**
   * Specular tint (rgb)
   *
   * The default gives a faint highlight. Fresnel lifts the tint toward white at grazing angles, so
   * a black tint doesn't remove the highlight; {@link PhongMaterialOptions#specularStrength} does.
   * @default 0x111111
   * @example
   * ```ts
   * const metalish = new PhongMaterial({ baseColor: 0x333333, specularColor: 0xcccccc });
   * ```
   */
  specularColor?: ColorSource;
  /**
   * Specular exponent: higher gives a smaller, sharper highlight
   *
   * Values below 1 act as 1.
   * @default 30
   * @example
   * ```ts
   * const glossy = new PhongMaterial({ shininess: 120 });
   * ```
   */
  shininess?: number;
  /**
   * Scales the whole highlight, Fresnel rim included; 0 removes it
   * @default 1
   * @example
   * ```ts
   * const chalk = new PhongMaterial({ specularStrength: 0 });
   * ```
   */
  specularStrength?: number;
  /**
   * Map whose red channel scales `specularStrength` per texel
   *
   * Pass it here to have one; afterwards it can be swapped through `material.textures.specular`.
   * @example
   * ```ts
   * const tiles = new PhongMaterial({ baseColorTexture: tilesTexture, specularTexture: groutMask });
   * ```
   */
  specularTexture?: Texture;
  /**
   * Tangent-space normal map
   *
   * Needs UVs on the geometry, and uses its tangents when it has them. Can also be assigned later
   * through `material.textures.normal`.
   * @example
   * ```ts
   * const stone = new PhongMaterial({ baseColorTexture: stoneTexture, normalTexture: stoneNormals });
   * ```
   */
  normalTexture?: Texture;
  /**
   * Strength of the normal map's bumps; no effect without a map
   * @default 1
   * @example
   * ```ts
   * const subtle = new PhongMaterial({ normalTexture: stoneNormals, normalScale: 0.4 });
   * ```
   */
  normalScale?: number;
  /**
   * The material's own glow; passing the group turns it on
   *
   * Change it later through {@link PhongMaterial#emissive}.
   * @example
   * ```ts
   * const screen = new PhongMaterial({ emissive: { texture: screenTexture, strength: 2 } });
   * ```
   */
  emissive?: EmissiveOptions;
}

/**
 * The fields of {@link PhongMaterial#data}
 *
 * `emissive` and `emissiveStrength` exist only on a material built with an `emissive` group; the
 * rest always do.
 * @category materials
 * @advanced
 */
export interface PhongData extends MaterialData {
  /** Base colour in linear light, alpha in the last lane */
  baseColor: Float32Array;
  /** Specular tint in linear light */
  specularColor: Float32Array;
  /** Specular exponent */
  shininess: number;
  /** Scale on the whole highlight */
  specularStrength: number;
  /** Cutoff for `alphaMode: 'mask'` */
  alphaCutoff: number;
  /** Strength of the normal map's bumps */
  normalScale: number;
  /** Glow colour in linear light */
  emissive?: Float32Array;
  /** Multiplier on the glow */
  emissiveStrength?: number;
}

/**
 * The texture slots of a {@link PhongMaterial}, as `material.textures`
 *
 * `baseColor` and `normal` always exist. `specular` and `emissive` exist only when the material
 * was built with `specularTexture` or an `emissive` group.
 * @example
 * ```ts
 * const material = new PhongMaterial({ specularTexture: shineMask });
 * material.textures.specular = otherShineMask;
 * ```
 * @category materials
 * @standard
 */
export interface PhongMaterialTextures extends MaterialTextures {
  /**
   * Base colour map
   * @example
   * ```ts
   * material.textures.baseColor = await Assets.load('bricks.png');
   * ```
   */
  baseColor: Texture;
  /**
   * Tangent-space normal map; holds a flat map until you assign one
   * @example
   * ```ts
   * material.textures.normal = await Assets.load('bricks-normal.png');
   * ```
   */
  normal: Texture;
  /**
   * Map whose red channel scales the highlight; only on a material built with `specularTexture`
   * @example
   * ```ts
   * material.textures.specular = wetPatches;
   * ```
   */
  specular?: Texture;
  /**
   * Glow map; only on a material built with an `emissive` group
   * @example
   * ```ts
   * material.textures.emissive = await Assets.load('lit-windows.png');
   * ```
   */
  emissive?: Texture;
}

/**
 * A Blinn-Phong material: diffuse shading plus a specular highlight
 *
 * Cheaper than {@link Material3D} and easy to art-direct: `shininess` sets the size of the
 * highlight and `specularColor` its tint. It follows the engine's lighting conventions, so a Phong
 * mesh and a PBR mesh read at the same brightness under the same lights.
 *
 * It takes direct lights, ambient lights and the view's `environment`. A cube map or hemisphere
 * adds diffuse fill only: highlights come from direct lights alone, so use {@link Material3D} for
 * surfaces that should reflect their surroundings.
 *
 * The specular and emissive maps cost nothing unless you pass them at construction. The normal map
 * can be assigned at any time; until there is one, no normal mapping is compiled in.
 *
 * `extraBits` run after the material's own maps and before lighting, so they see the textured
 * `albedo` and `alpha`. Their `end` code runs after lighting and before tone mapping.
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
   * Runtime glow controls; present only when the material was built with an `emissive` group
   * @example
   * ```ts
   * const lantern = new PhongMaterial({ emissive: { color: 0xffaa33 } });
   * lantern.emissive!.strength = 3;
   * ```
   */
  public readonly emissive?: EmissiveProps;

  /**
   * The specular-map and emissive bits this material was built with
   *
   * The constructor derives the layout from them and {@link PhongMaterial#getPrimaryDescriptor}
   * compiles the same list, so the two can't drift.
   */
  private readonly _featureBits: ShaderBit[] = [];

  /** Hex value `specularColor` reads back */
  private _specularColorTint = 0x111111;

  constructor(options: PhongMaterialOptions = {}) {
    const { specularTexture, normalTexture, emissive } = options;

    super(options);

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

    this._deriveLayoutFromBits([phongMaterialBit, uvTransformBit, ...this._featureBits, ...this._extraBits], textures);

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
   * Descriptors keyed by the name of the view's environment bit, so views with the same kind of
   * environment share one; cleared when the variant goes stale
   */
  private _descriptorByEnvKey: Record<string, ShaderDescriptor> = Object.create(null);

  /**
   * The shader descriptor for a view, cached per kind of environment
   *
   * The environment bit only supplies `sampleEnvironment`, with no struct field or texture, so
   * every kind of environment fits the layout derived at construction.
   * @param view - View whose environment picks the descriptor
   * @advanced
   */
  public override getPrimaryDescriptor(view: View3D): ShaderDescriptor {
    if (this._variantDirty) {
      this._descriptorByEnvKey = Object.create(null);
      this._variantDirty = false;
    }

    const envBit = view._envBit;
    let descriptor = this._descriptorByEnvKey[envBit.name];
    if (descriptor) return descriptor;

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

  /**
   * Specular exponent: higher gives a smaller, sharper highlight
   *
   * Values below 1 act as 1.
   * @example
   * ```ts
   * material.shininess = 80;
   * ```
   */
  public get shininess(): number {
    return this.data.shininess;
  }

  /**
   * Sets the specular exponent
   * @param value - Specular exponent; higher values tighten the highlight
   */
  public set shininess(value: number) {
    this.data.shininess = value;
  }

  /**
   * Scales the whole highlight, Fresnel rim included; 0 removes it
   *
   * `specularColor` alone can't remove it: Fresnel lifts any tint toward white at grazing angles,
   * so even black leaves a rim. A specular map multiplies on top of this.
   * @example
   * ```ts
   * material.specularStrength = 0.5;
   * ```
   */
  public get specularStrength(): number {
    return this.data.specularStrength;
  }

  /**
   * Sets the scale on the whole highlight
   * @param value - Scale on the whole specular lobe; 0 removes the highlight
   */
  public set specularStrength(value: number) {
    this.data.specularStrength = value;
  }

  /**
   * Strength of the normal map's bumps
   *
   * Matches glTF's `normalTextureInfo.scale`. 1 leaves the map as authored, and no value has an
   * effect without a map.
   * @example
   * ```ts
   * material.normalScale = 2;
   * ```
   */
  public get normalScale(): number {
    return this.data.normalScale;
  }

  /**
   * Sets the strength of the normal map's bumps
   * @param value - Multiplier on the normal map's tangent-space xy; 1 is a no-op
   */
  public set normalScale(value: number) {
    this.data.normalScale = value;
  }

  /**
   * Specular tint (rgb); takes any {@link ColorSource} and reads back a hex number, like
   * `Container.tint`
   * @example
   * ```ts
   * material.specularColor = 'white';
   * ```
   */
  public get specularColor(): number {
    return this._specularColorTint;
  }

  /**
   * Sets the specular tint
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
   * Frees the material for good
   *
   * Its textures stay alive unless `options` asks for them. Calling it again does nothing.
   * @param options - Whether to destroy the textures too, as {@link BaseMaterial3D#destroy} takes them
   * @example
   * ```ts
   * mesh.material.destroy();
   * ```
   */
  public override destroy(options?: TypeOrBool<TextureDestroyOptions>): void {
    if (this.destroyed) return;
    super.destroy(options);

    (this._descriptorByEnvKey as any) = null;
    this._featureBits.length = 0;
    (this as { /** @internal */ emissive?: EmissiveProps }).emissive = undefined;
  }
}
