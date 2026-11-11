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
import { createFeaturePropsClass, readFeatureProps } from '../utils/createFeaturePropsClass';
import type { MaterialData } from '../utils/createMaterialDataClass';
import type { MaterialTextures } from '../utils/createMaterialTexturesClass';
import { EmissivePropsClass } from '../utils/emissiveProps';
import type { EmissiveOptions, EmissiveProps } from '../utils/emissiveProps';
import { clearcoatBit, clearcoatNormalMapBit } from './bits/clearcoatBit';
import { iblBit } from './bits/iblBit';
import { iridescenceBit } from './bits/iridescenceBit';
import { pbrLightingBit } from './bits/pbrLightingBit';
import { pbrMaterialBit } from './bits/pbrMaterialBit';
import { sheenBit } from './bits/sheenBit';
import { specularBit } from './bits/specularBit';
import { transmissionBit } from './bits/transmissionBit';

/**
 * Options for a {@link Material3D}'s `specular` group (`KHR_materials_specular`): the strength and
 * tint of the reflection on non-metal surfaces
 * @example
 * ```ts
 * const varnish = new Material3D({ roughness: 0.3, specular: { factor: 0.6, color: 0xfff2dd } });
 * ```
 * @category materials
 * @standard
 */
export interface SpecularOptions {
  /**
   * Strength of the non-metal reflection, from 0 (none) to 1 (standard PBR)
   * @default 1
   * @example
   * ```ts
   * const matte = new Material3D({ specular: { factor: 0 } });
   * ```
   */
  factor?: number;
  /**
   * Tint of the non-metal reflection
   * @default 0xffffff
   * @example
   * ```ts
   * const warm = new Material3D({ specular: { color: 0xffd0a0 } });
   * ```
   */
  color?: ColorSource;
  /**
   * Strength map, read from alpha; used only when there is no `colorTexture`
   *
   * The two share a slot, so its colour channels tint the reflection too: keep them white.
   * @example
   * ```ts
   * const worn = new Material3D({ specular: { texture: wearMask } });
   * ```
   */
  texture?: Texture;
  /**
   * Tint in RGB and strength in alpha, the packed image; used over `texture` when both are given
   * @example
   * ```ts
   * const packed = new Material3D({ specular: { colorTexture: specularMap } });
   * ```
   */
  colorTexture?: Texture;
}

/**
 * Options for a {@link Material3D}'s `iridescence` group (`KHR_materials_iridescence`): a thin film
 * whose colour shifts with the viewing angle, like a soap bubble or an oil slick
 * @example
 * ```ts
 * const beetle = new Material3D({ metallic: 1, roughness: 0.2, iridescence: { thicknessMaximum: 500 } });
 * ```
 * @category materials
 * @standard
 */
export interface IridescenceOptions {
  /**
   * Strength of the effect, from 0 (none) to 1
   * @default 1
   * @example
   * ```ts
   * const hint = new Material3D({ iridescence: { factor: 0.3 } });
   * ```
   */
  factor?: number;
  /**
   * Index of refraction of the film
   * @default 1.3
   * @example
   * ```ts
   * const oily = new Material3D({ iridescence: { ior: 1.5 } });
   * ```
   */
  ior?: number;
  /**
   * Film thickness in nanometres where the texture's green channel is 0
   *
   * glTF's default is 100, which the glTF loader passes.
   * @default 0
   * @example
   * ```ts
   * const bubble = new Material3D({ iridescence: { thicknessMinimum: 100, thicknessTexture: filmMap } });
   * ```
   */
  thicknessMinimum?: number;
  /**
   * Film thickness in nanometres where the texture's green channel is 1, and so the thickness
   * everywhere when there is no texture
   * @default 400
   * @example
   * ```ts
   * const thickFilm = new Material3D({ iridescence: { thicknessMaximum: 800 } });
   * ```
   */
  thicknessMaximum?: number;
  /**
   * Factor in red and thickness in green, the packed image; used over `thicknessTexture` when both
   * are given
   * @example
   * ```ts
   * const packed = new Material3D({ iridescence: { texture: iridescenceMap } });
   * ```
   */
  texture?: Texture;
  /**
   * Thickness map, read from green; used only when there is no `texture`
   *
   * The two share a slot, so its red channel scales the factor too: keep it white.
   * @example
   * ```ts
   * const swirl = new Material3D({ iridescence: { thicknessTexture: swirlMap } });
   * ```
   */
  thicknessTexture?: Texture;
}

/**
 * Options for a {@link Material3D}'s `transmission` group (`KHR_materials_transmission` with
 * `KHR_materials_volume`): glass and other surfaces you see through
 *
 * Through a transmissive mesh you see the background and the opaque meshes, tinted by its base colour
 * and blurred by its roughness, but not other transmissive or blended meshes. On WebGL, glass in a
 * view drawn straight onto an opaque canvas shows nothing through. Start the application with
 * `useBackBuffer: true`, or, when the scene has `doubleSided` materials, whose lighting that option
 * breaks, give the view `composite: true`.
 * @example
 * ```ts
 * const glass = new Material3D({ roughness: 0.05, transmission: { thickness: 0.5 } });
 * ```
 * @category materials
 * @standard
 */
export interface TransmissionOptions {
  /**
   * How much light passes through, from 0 (opaque surface) to 1 (clear glass)
   * @default 1
   * @example
   * ```ts
   * const frosted = new Material3D({ roughness: 0.6, transmission: { factor: 0.9 } });
   * ```
   */
  factor?: number;
  /**
   * Map whose red channel scales `factor`
   * @example
   * ```ts
   * const stainedGlass = new Material3D({ transmission: { texture: leadingMask } });
   * ```
   */
  texture?: Texture;
  /**
   * Thickness of the volume in the mesh's own units, scaled with the mesh
   *
   * 0 makes a thin wall: light doesn't bend and isn't absorbed.
   * @default 0
   * @example
   * ```ts
   * const block = new Material3D({ transmission: { thickness: 1 } });
   * ```
   */
  thickness?: number;
  /**
   * Map whose green channel scales `thickness`
   * @example
   * ```ts
   * const bottle = new Material3D({ transmission: { thickness: 0.3, thicknessTexture: wallThickness } });
   * ```
   */
  thicknessTexture?: Texture;
  /**
   * Distance in world units that light travels through the volume before it takes on
   * `attenuationColor`
   *
   * Left out, light isn't absorbed. Absorption also needs `thickness` above 0.
   * @example
   * ```ts
   * const wine = new Material3D({
   *   transmission: { thickness: 1, attenuationDistance: 1, attenuationColor: 0x7a0f1e },
   * });
   * ```
   */
  attenuationDistance?: number;
  /**
   * Colour white light turns after travelling `attenuationDistance` through the volume
   * @default 0xffffff
   * @example
   * ```ts
   * const bottleGreen = new Material3D({
   *   transmission: { thickness: 0.5, attenuationDistance: 1, attenuationColor: 0x2e8b57 },
   * });
   * ```
   */
  attenuationColor?: ColorSource;
}

/**
 * Options for a {@link Material3D}'s `clearcoat` group (`KHR_materials_clearcoat`): a clear lacquer
 * layer on top, as on car paint or varnished wood
 * @example
 * ```ts
 * const carPaint = new Material3D({ baseColor: 0x8c1c13, roughness: 0.5, clearcoat: { roughness: 0.03 } });
 * ```
 * @category materials
 * @standard
 */
export interface ClearcoatOptions {
  /**
   * Strength of the coat, from 0 (none) to 1
   * @default 1
   * @example
   * ```ts
   * const satinVarnish = new Material3D({ clearcoat: { factor: 0.5 } });
   * ```
   */
  factor?: number;
  /**
   * Roughness of the coat, independent of the surface underneath
   * @default 0
   * @example
   * ```ts
   * const hazyCoat = new Material3D({ clearcoat: { roughness: 0.4 } });
   * ```
   */
  roughness?: number;
  /**
   * Strength of the coat normal map's bumps
   * @default 1
   * @example
   * ```ts
   * const orangePeel = new Material3D({ clearcoat: { normalTexture: peelNormals, normalScale: 0.3 } });
   * ```
   */
  normalScale?: number;
  /**
   * Map whose red channel scales `factor`
   * @example
   * ```ts
   * const chipped = new Material3D({ clearcoat: { texture: chipMask } });
   * ```
   */
  texture?: Texture;
  /**
   * Map whose green channel scales `roughness`
   * @example
   * ```ts
   * const smudged = new Material3D({ clearcoat: { roughness: 1, roughnessTexture: smudgeMap } });
   * ```
   */
  roughnessTexture?: Texture;
  /**
   * Normal map for the coat alone, green up like {@link Material3DOptions#normalTexture}
   *
   * Pass it here to have one; to add one later, {@link BaseMaterial3D#clone | clone} the material
   * with it. Without it the coat follows the geometry's normals, not the base normal map, and costs
   * less.
   * @example
   * ```ts
   * const dimpled = new Material3D({ clearcoat: { normalTexture: dimpleNormals } });
   * ```
   */
  normalTexture?: Texture;
}

/**
 * Options for a {@link Material3D}'s `sheen` group (`KHR_materials_sheen`): the soft glow at grazing
 * angles on velvet, satin and other cloth
 * @example
 * ```ts
 * const velvet = new Material3D({ baseColor: 0x3b0a45, roughness: 0.9, sheen: { color: 0xd8a0ff } });
 * ```
 * @category materials
 * @standard
 */
export interface SheenOptions {
  /**
   * Colour of the sheen; black turns it off
   * @default 0xffffff
   * @example
   * ```ts
   * const silk = new Material3D({ sheen: { color: 0xfff0e0 } });
   * ```
   */
  color?: ColorSource;
  /**
   * Roughness of the sheen, from 0 to 1
   * @default 0
   * @example
   * ```ts
   * const felt = new Material3D({ sheen: { roughness: 0.8 } });
   * ```
   */
  roughness?: number;
  /**
   * Colour in RGB and roughness in alpha, the packed image; used over `roughnessTexture` when both
   * are given
   * @example
   * ```ts
   * const fabric = new Material3D({ sheen: { texture: sheenMap } });
   * ```
   */
  texture?: Texture;
  /**
   * Roughness map, read from alpha; used only when there is no `texture`
   *
   * The two share a slot, so its colour channels tint the sheen too: keep them white.
   * @example
   * ```ts
   * const worn = new Material3D({ sheen: { roughnessTexture: wearMap } });
   * ```
   */
  roughnessTexture?: Texture;
}

/**
 * Options for a {@link Material3D}'s `anisotropy` group (`KHR_materials_anisotropy`): highlights
 * stretched along one direction, as on brushed metal, vinyl records or carbon fibre
 * @example
 * ```ts
 * const brushed = new Material3D({ metallic: 1, roughness: 0.4, anisotropy: { strength: 0.8 } });
 * ```
 * @category materials
 * @standard
 */
export interface AnisotropyOptions {
  /**
   * How strongly highlights stretch, from 0 to 1
   * @default 1
   * @example
   * ```ts
   * const lightlyBrushed = new Material3D({ anisotropy: { strength: 0.3 } });
   * ```
   */
  strength?: number;
  /**
   * Rotation of the stretch direction in radians, starting from the surface's tangent
   * @default 0
   * @example
   * ```ts
   * const crossGrain = new Material3D({ anisotropy: { rotation: Math.PI / 2 } });
   * ```
   */
  rotation?: number;
  /**
   * Per-texel direction in RG (a -1 to 1 vector stored as 0 to 1) and strength in B
   *
   * Pass it here to have one; to add one later, {@link BaseMaterial3D#clone | clone} the material
   * with it. Without it the direction is the tangent, turned by `rotation`, everywhere.
   * @example
   * ```ts
   * const carbonFibre = new Material3D({ anisotropy: { texture: weaveDirections } });
   * ```
   */
  texture?: Texture;
}

/**
 * Options for {@link Material3D}
 *
 * Each extension (`emissive`, `specular`, `iridescence`, `transmission`, `clearcoat`, `sheen`,
 * `anisotropy`) is a group that turns the feature on when passed, even empty: `clearcoat: {}` adds a
 * full-strength coat. Inside a group, each factor and strength defaults to 1 and each colour to
 * white; the glTF loader passes each extension's own defaults instead.
 * @example
 * ```ts
 * const options: Material3DOptions = { baseColor: 0x8c1c13, roughness: 0.4, clearcoat: {} };
 * const carPaint = new Material3D(options);
 * ```
 * @category materials
 * @standard
 */
export interface Material3DOptions extends Omit<BaseMaterial3DOptions, 'descriptor'> {
  /**
   * Tangent-space normal map, green up as in glTF and OpenGL
   *
   * Invert the green channel of a DirectX-style map, or its bumps light from the wrong side. Needs UVs
   * on the geometry, and uses its tangents when it has them. Can be assigned later through
   * `material.textures.normal`; a material without one pays nothing for normal mapping.
   * @example
   * ```ts
   * const bricks = new Material3D({ baseColorTexture: brickColour, normalTexture: brickNormals });
   * ```
   */
  normalTexture?: Texture;
  /**
   * Strength of the normal map's bumps
   * @default 1
   * @example
   * ```ts
   * const shallow = new Material3D({ normalTexture: brickNormals, normalScale: 0.5 });
   * ```
   */
  normalScale?: number;

  /**
   * Perceptual roughness, from 0 (mirror-like) to 1 (fully rough)
   * @default 1
   * @example
   * ```ts
   * const polished = new Material3D({ roughness: 0.1 });
   * ```
   */
  roughness?: number;
  /**
   * Metalness, from 0 (non-metal) to 1 (metal)
   * @default 0
   * @example
   * ```ts
   * const gold = new Material3D({ baseColor: 0xffc356, metallic: 1, roughness: 0.25 });
   * ```
   */
  metallic?: number;
  /**
   * Map with roughness in green and metalness in blue, as in glTF; scales `roughness` and
   * `metallic`
   * @example
   * ```ts
   * const rusty = new Material3D({ metallic: 1, metallicRoughnessTexture: rustMap });
   * ```
   */
  metallicRoughnessTexture?: Texture;

  /**
   * Ambient occlusion map, read from red; it darkens ambient and environment light only
   * @example
   * ```ts
   * const crate = new Material3D({ baseColorTexture: crateColour, occlusionTexture: crateOcclusion });
   * ```
   */
  occlusionTexture?: Texture;
  /**
   * Multiplier on the occlusion, see {@link Material3D#occlusionStrength}
   * @default 1
   * @example
   * ```ts
   * const softer = new Material3D({ occlusionTexture: crateOcclusion, occlusionStrength: 0.8 });
   * ```
   */
  occlusionStrength?: number;

  /**
   * Index of refraction, see {@link Material3D#ior}
   * @default 1.5
   * @example
   * ```ts
   * const water = new Material3D({ ior: 1.33, transmission: { thickness: 1 } });
   * ```
   */
  ior?: number;

  /**
   * The material's own glow; passing the group turns it on
   * @example
   * ```ts
   * const lava = new Material3D({ emissive: { texture: lavaGlow, strength: 4 } });
   * ```
   */
  emissive?: EmissiveOptions;
  /**
   * Strength and tint of non-metal reflections; passing the group turns it on
   * @example
   * ```ts
   * const lacquer = new Material3D({ specular: { color: 0xfff4e0 } });
   * ```
   */
  specular?: SpecularOptions;
  /**
   * Thin-film colour shift; passing the group turns it on
   * @example
   * ```ts
   * const soapBubble = new Material3D({ iridescence: {}, transmission: {} });
   * ```
   */
  iridescence?: IridescenceOptions;
  /**
   * Glass and other see-through surfaces; passing the group turns it on
   * @example
   * ```ts
   * const pane = new Material3D({ roughness: 0, transmission: {} });
   * ```
   */
  transmission?: TransmissionOptions;
  /**
   * Clear lacquer layer on top; passing the group turns it on
   * @example
   * ```ts
   * const pianoBlack = new Material3D({ baseColor: 0x050505, clearcoat: {} });
   * ```
   */
  clearcoat?: ClearcoatOptions;
  /**
   * Cloth sheen; passing the group turns it on
   * @example
   * ```ts
   * const cushion = new Material3D({ sheen: { color: 0xffffff, roughness: 0.5 } });
   * ```
   */
  sheen?: SheenOptions;
  /**
   * Highlights stretched along one direction; passing the group turns it on
   * @example
   * ```ts
   * const pan = new Material3D({ metallic: 1, anisotropy: {} });
   * ```
   */
  anisotropy?: AnisotropyOptions;
}

/**
 * Runtime controls for a material's `specular` group, as `material.specular`
 * @example
 * ```ts
 * const material = new Material3D({ specular: {} });
 * material.specular!.factor = 0.25;
 * ```
 * @category materials
 * @standard
 */
export interface SpecularProps {
  /**
   * Strength of the non-metal reflection, from 0 (none) to 1 (standard PBR)
   * @example
   * ```ts
   * material.specular!.factor = 0;
   * ```
   */
  factor: number;
  /**
   * Tint of the non-metal reflection; takes any `ColorSource` and reads back a hex number, like
   * `Container.tint`
   * @example
   * ```ts
   * material.specular!.color = 0xffe0c0;
   * ```
   */
  get color(): number;
  /** Sets the tint from any `ColorSource` */
  set color(value: ColorSource);
  /**
   * The packed map, tint in RGB and strength in alpha
   * @example
   * ```ts
   * material.specular!.texture = await Assets.load('specular.png');
   * ```
   */
  texture: Texture;
}

/**
 * Runtime controls for a material's `iridescence` group, as `material.iridescence`
 * @example
 * ```ts
 * const material = new Material3D({ iridescence: {} });
 * material.iridescence!.thicknessMaximum = 600;
 * ```
 * @category materials
 * @standard
 */
export interface IridescenceProps {
  /**
   * Strength of the effect, from 0 (none) to 1
   * @example
   * ```ts
   * material.iridescence!.factor = 0.5;
   * ```
   */
  factor: number;
  /**
   * Index of refraction of the film
   * @example
   * ```ts
   * material.iridescence!.ior = 1.4;
   * ```
   */
  ior: number;
  /**
   * Film thickness in nanometres where the texture's green channel is 0
   * @example
   * ```ts
   * material.iridescence!.thicknessMinimum = 100;
   * ```
   */
  thicknessMinimum: number;
  /**
   * Film thickness in nanometres where the texture's green channel is 1
   * @example
   * ```ts
   * material.iridescence!.thicknessMaximum = 500;
   * ```
   */
  thicknessMaximum: number;
  /**
   * The packed map, factor in red and thickness in green
   * @example
   * ```ts
   * material.iridescence!.texture = await Assets.load('film.png');
   * ```
   */
  texture: Texture;
}

/**
 * Runtime controls for a material's `transmission` group, as `material.transmission`
 * @example
 * ```ts
 * const material = new Material3D({ transmission: {} });
 * material.transmission!.thickness = 0.4;
 * ```
 * @category materials
 * @standard
 */
export interface TransmissionProps {
  /**
   * How much light passes through, from 0 (opaque surface) to 1 (clear glass)
   * @example
   * ```ts
   * material.transmission!.factor = 0.5;
   * ```
   */
  factor: number;
  /**
   * Thickness of the volume in the mesh's own units; 0 makes a thin wall
   * @example
   * ```ts
   * material.transmission!.thickness = 2;
   * ```
   */
  thickness: number;
  /**
   * Distance in world units that light travels through the volume before it takes on
   * `attenuationColor`
   *
   * 1e9 or more turns absorption off.
   * @example
   * ```ts
   * material.transmission!.attenuationDistance = 0.5;
   * ```
   */
  attenuationDistance: number;
  /**
   * Colour white light turns after travelling `attenuationDistance`; takes any `ColorSource` and
   * reads back a hex number, like `Container.tint`
   * @example
   * ```ts
   * material.transmission!.attenuationColor = 'teal';
   * ```
   */
  get attenuationColor(): number;
  /** Sets the attenuation colour from any `ColorSource` */
  set attenuationColor(value: ColorSource);
  /**
   * Map whose red channel scales `factor`
   * @example
   * ```ts
   * material.transmission!.texture = await Assets.load('frost-mask.png');
   * ```
   */
  texture: Texture;
  /**
   * Map whose green channel scales `thickness`
   * @example
   * ```ts
   * material.transmission!.thicknessTexture = await Assets.load('thickness.png');
   * ```
   */
  thicknessTexture: Texture;
}

/**
 * Runtime controls for a material's `clearcoat` group, as `material.clearcoat`
 * @example
 * ```ts
 * const material = new Material3D({ clearcoat: {} });
 * material.clearcoat!.roughness = 0.2;
 * ```
 * @category materials
 * @standard
 */
export interface ClearcoatProps {
  /**
   * Strength of the coat, from 0 (none) to 1
   * @example
   * ```ts
   * material.clearcoat!.factor = 0.7;
   * ```
   */
  factor: number;
  /**
   * Roughness of the coat, independent of the surface underneath
   * @example
   * ```ts
   * material.clearcoat!.roughness = 0.1;
   * ```
   */
  roughness: number;
  /**
   * Strength of the coat normal map's bumps; no effect without a coat normal map
   * @example
   * ```ts
   * material.clearcoat!.normalScale = 0.5;
   * ```
   */
  normalScale: number;
  /**
   * Map whose red channel scales `factor`
   * @example
   * ```ts
   * material.clearcoat!.texture = await Assets.load('coat-mask.png');
   * ```
   */
  texture: Texture;
  /**
   * Map whose green channel scales `roughness`
   * @example
   * ```ts
   * material.clearcoat!.roughnessTexture = await Assets.load('coat-roughness.png');
   * ```
   */
  roughnessTexture: Texture;
  /**
   * The coat normal map, or `undefined` when the material was built without one
   *
   * Read-only: to add one, {@link BaseMaterial3D#clone | clone} the material with
   * `clearcoat: { normalTexture }`; to swap it, assign `material.textures.clearcoatNormal`.
   * @advanced
   */
  readonly normalTexture?: Texture;
}

/**
 * Runtime controls for a material's `sheen` group, as `material.sheen`
 * @example
 * ```ts
 * const material = new Material3D({ sheen: {} });
 * material.sheen!.color = 0xffd0e0;
 * ```
 * @category materials
 * @standard
 */
export interface SheenProps {
  /**
   * Colour of the sheen; takes any `ColorSource` and reads back a hex number, like
   * `Container.tint`
   * @example
   * ```ts
   * material.sheen!.color = 'pink';
   * ```
   */
  get color(): number;
  /** Sets the sheen colour from any `ColorSource` */
  set color(value: ColorSource);
  /**
   * Roughness of the sheen, from 0 to 1
   * @example
   * ```ts
   * material.sheen!.roughness = 0.6;
   * ```
   */
  roughness: number;
  /**
   * The packed map, colour in RGB and roughness in alpha
   * @example
   * ```ts
   * material.sheen!.texture = await Assets.load('sheen.png');
   * ```
   */
  texture: Texture;
}

/**
 * Runtime controls for a material's `anisotropy` group, as `material.anisotropy`
 * @example
 * ```ts
 * const material = new Material3D({ metallic: 1, anisotropy: {} });
 * material.anisotropy!.rotation = Math.PI / 4;
 * ```
 * @category materials
 * @standard
 */
export interface AnisotropyProps {
  /**
   * How strongly highlights stretch, from 0 to 1
   * @example
   * ```ts
   * material.anisotropy!.strength = 0.5;
   * ```
   */
  strength: number;
  /**
   * Rotation of the stretch direction in radians, starting from the surface's tangent
   * @example
   * ```ts
   * material.anisotropy!.rotation += 0.01;
   * ```
   */
  rotation: number;
  /**
   * The direction map (direction in RG, strength in B), or `undefined` when the material was built
   * without one
   *
   * Read-only: to add one, {@link BaseMaterial3D#clone | clone} the material with
   * `anisotropy: { texture }`; to swap it, assign `material.textures.anisotropy`.
   * @advanced
   */
  readonly texture?: Texture;
}

const SpecularPropsClass = createFeaturePropsClass<SpecularProps>({
  factor: { kind: 'lane', field: 'specularParams', lane: 3 },
  color: { kind: 'colour', field: 'specularParams' },
  texture: { kind: 'texture', slot: 'specular' },
});

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
  texture: { kind: 'texture', slot: 'anisotropy', readonly: true },
});

/**
 * The texture slots of a {@link Material3D}, as `material.textures`
 *
 * The four core slots always exist. The others exist only when the material was built with the
 * matching group, and `clearcoatNormal` and `anisotropy` only when that group had its texture. Each
 * option group says how its slot is packed.
 * @example
 * ```ts
 * const material = new Material3D({ baseColorTexture: bricks });
 * material.textures.baseColor = mossyBricks;
 * ```
 * @category materials
 * @standard
 */
export interface Material3DTextures extends MaterialTextures {
  /**
   * Base colour map
   * @example
   * ```ts
   * material.textures.baseColor = await Assets.load('albedo.png');
   * ```
   */
  baseColor: Texture;
  /**
   * Roughness in green, metalness in blue
   * @example
   * ```ts
   * material.textures.metallicRoughness = await Assets.load('metal-rough.png');
   * ```
   */
  metallicRoughness: Texture;
  /**
   * Ambient occlusion in red
   * @example
   * ```ts
   * material.textures.occlusion = await Assets.load('occlusion.png');
   * ```
   */
  occlusion: Texture;
  /**
   * Tangent-space normal map; holds a flat map until you assign one
   * @example
   * ```ts
   * material.textures.normal = await Assets.load('normal.png');
   * ```
   */
  normal: Texture;
  /**
   * Glow map
   * @example
   * ```ts
   * material.textures.emissive = await Assets.load('glow.png');
   * ```
   */
  emissive?: Texture;
  /**
   * Specular tint in RGB, strength in alpha
   * @example
   * ```ts
   * material.textures.specular = await Assets.load('specular.png');
   * ```
   */
  specular?: Texture;
  /**
   * Iridescence factor in red, film thickness in green
   * @example
   * ```ts
   * material.textures.iridescence = await Assets.load('film.png');
   * ```
   */
  iridescence?: Texture;
  /**
   * Transmission factor in red
   * @example
   * ```ts
   * material.textures.transmission = await Assets.load('frost-mask.png');
   * ```
   */
  transmission?: Texture;
  /**
   * Volume thickness in green
   * @example
   * ```ts
   * material.textures.thickness = await Assets.load('thickness.png');
   * ```
   */
  thickness?: Texture;
  /**
   * Clearcoat factor in red
   * @example
   * ```ts
   * material.textures.clearcoat = await Assets.load('coat-mask.png');
   * ```
   */
  clearcoat?: Texture;
  /**
   * Clearcoat roughness in green
   * @example
   * ```ts
   * material.textures.clearcoatRoughness = await Assets.load('coat-roughness.png');
   * ```
   */
  clearcoatRoughness?: Texture;
  /**
   * Clearcoat normal map
   * @example
   * ```ts
   * material.textures.clearcoatNormal = await Assets.load('coat-normal.png');
   * ```
   */
  clearcoatNormal?: Texture;
  /**
   * Sheen colour in RGB, roughness in alpha
   * @example
   * ```ts
   * material.textures.sheen = await Assets.load('sheen.png');
   * ```
   */
  sheen?: Texture;
  /**
   * Anisotropy direction in RG, strength in B
   * @example
   * ```ts
   * material.textures.anisotropy = await Assets.load('brush-direction.png');
   * ```
   */
  anisotropy?: Texture;
}

/**
 * The fields of {@link Material3D#data}
 *
 * The core fields always exist; the others only when the material was built with the matching
 * group.
 * @category materials
 * @advanced
 */
export interface Material3DData extends MaterialData {
  /** Base colour in linear light, alpha in the last lane */
  baseColor: Float32Array;
  /** Lanes: metallic, roughness, occlusionStrength, ior */
  pbrParams: Float32Array;
  /** Strength of the normal map's bumps */
  normalScale: number;
  /** Lanes: transmission factor, thickness, attenuationDistance, iridescence factor */
  transmissionVolume: Float32Array;
  /** Lanes: attenuationColor in linear light, iridescence IOR */
  attenuationColorIrid: Float32Array;
  /** Glow colour in linear light */
  emissive?: Float32Array;
  /** Multiplier on the glow */
  emissiveStrength?: number;
  /** Iridescence film thickness in nanometres where the texture's green channel is 1 */
  iridescenceThickness?: number;
  /** Iridescence film thickness in nanometres where the texture's green channel is 0 */
  iridescenceThicknessMinimum?: number;
  /** Lanes: specular tint in linear light, factor */
  specularParams?: Float32Array;
  /** Lanes: factor, roughness, normalScale, unused */
  clearcoatParams?: Float32Array;
  /** Lanes: sheen colour in linear light, roughness */
  sheenParams?: Float32Array;
  /** Lanes: strength, rotation, unused, unused */
  anisotropyParams?: Float32Array;
}

/**
 * The standard physically based (PBR) material
 *
 * Base colour, metalness and roughness, with normal, occlusion and emissive maps, plus the glTF
 * extensions for specular, iridescence, transmission and volume, clearcoat, sheen and anisotropy.
 * glTF materials load into it, except unlit ones, which load as {@link FlatMaterial}.
 *
 * Each extension is an option group, and passing one gives the material a runtime object of the same
 * name: `new Material3D({ clearcoat: { roughness: 0.2 } })` gives `material.clearcoat.roughness`.
 * Writing to it, or to a core value such as `roughness`, never recompiles the shader.
 *
 * The groups passed to the constructor fix the material's features for good. A group left out costs
 * nothing, while a feature turned off at runtime, such as a coat at factor 0, keeps its cost. To add
 * a feature to a material that exists, such as one the glTF loader built,
 * `material.clone({ clearcoat: { factor: 1 } })` ({@link BaseMaterial3D#clone}) makes a copy with it
 * and everything else the material has.
 *
 * Custom shader code in {@link BaseMaterial3DOptions#extraBits} runs after the features in each
 * slot, and in the `material` slot before the `'mask'` cutoff, so it sees the final `albedo` and
 * `alpha`, and alpha it writes there still reaches the cutoff. Like the groups, it's fixed when the
 * material is built, and `clone({ extraBits })` makes a copy with more.
 * @example
 * ```ts
 * const paint = new Material3D({
 *   baseColor: 0x8c1c13,
 *   metallic: 0.2,
 *   roughness: 0.5,
 *   clearcoat: { roughness: 0.05 },
 * });
 * paint.clearcoat!.factor = 0.8;
 * ```
 * @category materials
 * @standard
 */
export class Material3D extends BaseMaterial3D<Material3DData, Material3DTextures, Material3DOptions> {
  /**
   * Runtime glow controls; present only when the material was built with an `emissive` group
   * @example
   * ```ts
   * if (material.emissive) material.emissive.strength = 2;
   * ```
   */
  public readonly emissive?: EmissiveProps;
  /**
   * Runtime specular controls; present only when the material was built with a `specular` group
   * @example
   * ```ts
   * if (material.specular) material.specular.factor = 0.5;
   * ```
   */
  public readonly specular?: SpecularProps;
  /**
   * Runtime iridescence controls; present only when the material was built with an `iridescence`
   * group
   * @example
   * ```ts
   * if (material.iridescence) material.iridescence.factor = 1;
   * ```
   */
  public readonly iridescence?: IridescenceProps;
  /**
   * Runtime transmission controls; present only when the material was built with a `transmission`
   * group
   * @example
   * ```ts
   * if (material.transmission) material.transmission.factor = 0.9;
   * ```
   */
  public readonly transmission?: TransmissionProps;
  /**
   * Runtime clearcoat controls; present only when the material was built with a `clearcoat` group
   * @example
   * ```ts
   * if (material.clearcoat) material.clearcoat.roughness = 0.1;
   * ```
   */
  public readonly clearcoat?: ClearcoatProps;
  /**
   * Runtime sheen controls; present only when the material was built with a `sheen` group
   * @example
   * ```ts
   * if (material.sheen) material.sheen.roughness = 0.4;
   * ```
   */
  public readonly sheen?: SheenProps;
  /**
   * Runtime anisotropy controls; present only when the material was built with an `anisotropy`
   * group
   * @example
   * ```ts
   * if (material.anisotropy) material.anisotropy.rotation = Math.PI / 2;
   * ```
   */
  public readonly anisotropy?: AnisotropyProps;

  /**
   * In shader order: `specularBit` sets the F0 and `f90` that `iridescenceBit` and `transmissionBit`
   * read, and `emissiveBit` assigns the `emissive` that `transmissionBit` adds to
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
      this._passBit = (this._passBit & ~RenderPassBit.MATERIAL_PASS_MASK) | RenderPassBit.TRANSMISSION;
    }

    const textures: Record<string, Texture | undefined> = {
      baseColor: options.baseColorTexture,
      metallicRoughness: options.metallicRoughnessTexture,
      occlusion: options.occlusionTexture,
      normal: options.normalTexture ?? NORMAL_MAP,
      ...options.textures,
    };

    if (emissive) {
      textures.emissive = emissive.texture;
      this._featureBits.push(emissiveBit);
    }

    if (specular) {
      textures.specular = specular.colorTexture ?? specular.texture;
      this._featureBits.push(specularBit);
    }

    if (iridescence) {
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
      if (clearcoat.normalTexture) {
        textures.clearcoatNormal = clearcoat.normalTexture;
        this._featureBits.push(clearcoatNormalMapBit);
      } else {
        this._featureBits.push(clearcoatBit);
      }
    }

    if (sheen) {
      textures.sheen = sheen.texture ?? sheen.roughnessTexture;
      this._featureBits.push(sheenBit);
    }

    if (anisotropy) {
      if (anisotropy.texture) {
        textures.anisotropy = anisotropy.texture;
        this._featureBits.push(anisotropyTextureBit);
      } else {
        this._featureBits.push(anisotropyBit);
      }
    }

    this._deriveLayoutFromBits([pbrMaterialBit, uvTransformBit, ...this._featureBits, ...this.extraBits], textures);

    const data = this.data;

    data.pbrParams[0] = options.metallic ?? 0;
    data.pbrParams[1] = options.roughness ?? 1;
    data.pbrParams[2] = options.occlusionStrength ?? 1;
    data.pbrParams[3] = options.ior ?? 1.5;
    data.normalScale = options.normalScale ?? 1;

    data.transmissionVolume[2] = 1e10;
    const attenuationColorIrid = data.attenuationColorIrid;
    writeLinearRgb(attenuationColorIrid, 0, Color.shared.setValue(0xffffff));
    attenuationColorIrid[3] = 1.3;

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
   * `iblBit` joins only when the view has an environment, since the compiler may still run work
   * multiplied by the zero that `envSourceDefaultBit` returns
   */
  private _descriptorByEnvKey: Record<string, ShaderDescriptor> = Object.create(null);

  /**
   * The shader descriptor for a view, cached per kind of environment
   * @param view - View whose environment picks the descriptor
   * @advanced
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

    const bitsGpu = [pbrMaterialBit, envBit];
    const bitsGl = [pbrMaterialBit, envBit];

    if (view.environment !== null) {
      bitsGpu.push(iblBit);
      bitsGl.push(iblBit);
    }

    bitsGpu.push(pbrLightingBit);
    bitsGl.push(pbrLightingBit);

    bitsGpu.push(uvTransformBit);
    bitsGl.push(uvTransformBit);
    bitsGpu.push(...this._featureBits);
    bitsGl.push(...this._featureBits);
    bitsGpu.push(...this.extraBits);
    bitsGl.push(...this.extraBits);
    if (this._alphaMode === 'mask') {
      bitsGpu.push(alphaMaskBit);
      bitsGl.push(alphaMaskBit);
    }

    descriptor = new ShaderDescriptor({});
    descriptor.update({ bitsGpu, bitsGl });
    this._descriptorByEnvKey[envKey] = descriptor;
    return descriptor;
  }

  /**
   * The base options plus the PBR values, maps and each feature group the material has
   * @advanced
   */
  protected override _toOptions(): Material3DOptions {
    const { emissive, specular, iridescence, transmission, clearcoat, sheen, anisotropy, textures } = this;

    return {
      ...super._toOptions(),
      metallic: this.metallic,
      roughness: this.roughness,
      occlusionStrength: this.occlusionStrength,
      ior: this.ior,
      normalScale: this.normalScale,
      normalTexture: textures.normal,
      metallicRoughnessTexture: textures.metallicRoughness,
      occlusionTexture: textures.occlusion,
      emissive: emissive && readFeatureProps(emissive),
      specular: specular && readFeatureProps(specular),
      iridescence: iridescence && readFeatureProps(iridescence),
      transmission: transmission && readFeatureProps(transmission),
      clearcoat: clearcoat && readFeatureProps(clearcoat),
      sheen: sheen && readFeatureProps(sheen),
      anisotropy: anisotropy && readFeatureProps(anisotropy),
    };
  }

  /**
   * Metalness, from 0 (non-metal) to 1 (metal)
   *
   * Ambient lights don't light a metal, so with no environment a metal is dark except for its
   * highlights.
   * @default 0
   * @example
   * ```ts
   * material.metallic = 1;
   * ```
   */
  public get metallic(): number {
    return this.data.pbrParams[0];
  }
  /**
   * Sets the metalness
   * @param value - Metalness, 0 to 1
   */
  public set metallic(value: number) {
    if (this.data.pbrParams[0] === Math.fround(value)) return;
    this.data.pbrParams[0] = value;
    this.update();
  }

  /**
   * Perceptual roughness, from 0 (mirror-like) to 1 (fully rough)
   * @default 1
   * @example
   * ```ts
   * material.roughness = 0.2;
   * ```
   */
  public get roughness(): number {
    return this.data.pbrParams[1];
  }
  /**
   * Sets the perceptual roughness
   * @param value - Roughness, 0 to 1
   */
  public set roughness(value: number) {
    if (this.data.pbrParams[1] === Math.fround(value)) return;
    this.data.pbrParams[1] = value;
    this.update();
  }

  /**
   * Multiplier on the occlusion
   *
   * Ambient and environment light are scaled by the sampled occlusion times this value, so values
   * below 1 darken that light even where the map is white, and values above 1 brighten it.
   * @default 1
   * @example
   * ```ts
   * material.occlusionStrength = 0.8;
   * ```
   */
  public get occlusionStrength(): number {
    return this.data.pbrParams[2];
  }
  /**
   * Sets the multiplier on the occlusion
   * @param value - Multiplier on the occlusion
   */
  public set occlusionStrength(value: number) {
    if (this.data.pbrParams[2] === Math.fround(value)) return;
    this.data.pbrParams[2] = value;
    this.update();
  }

  /**
   * Index of refraction (`KHR_materials_ior`); sets how strongly non-metals reflect, and how far
   * transmission bends light
   * @default 1.5
   * @example
   * ```ts
   * material.ior = 1.33;
   * ```
   */
  public get ior(): number {
    return this.data.pbrParams[3];
  }
  /**
   * Sets the index of refraction
   * @param value - Refractive index; 1.5 suits most glass and plastic
   */
  public set ior(value: number) {
    if (this.data.pbrParams[3] === Math.fround(value)) return;
    this.data.pbrParams[3] = value;
    this.update();
  }

  /**
   * Strength of the normal map's bumps; 1 leaves the map as authored
   * @default 1
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
   * @param value - Bump strength
   */
  public set normalScale(value: number) {
    this.data.normalScale = value;
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

    (this._descriptorByEnvKey as Record<string, ShaderDescriptor> | null) = null;
    (this._featureBits as ShaderBit[] | null) = null;

    /** @internal */
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
