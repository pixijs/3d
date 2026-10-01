import { Matrix, warn } from 'pixi.js';

import { linearToSrgb } from '../../../../materials/BaseMaterial3D';
import type { BaseMaterial3D, BaseMaterial3DOptions } from '../../../../materials/BaseMaterial3D';
import { FlatMaterial } from '../../../../materials/flat/FlatMaterial';
import { Material3D } from '../../../../materials/pbr/Material3D';
import type {
  AnisotropyOptions,
  ClearcoatOptions,
  IridescenceOptions,
  Material3DOptions,
  SheenOptions,
  SpecularOptions,
  TransmissionOptions,
} from '../../../../materials/pbr/Material3D';
import type { EmissiveOptions } from '../../../../materials/utils/emissiveProps';
import type { Scene3DSource } from '../../../Scene3DSource';
import type { GltfFormat, KHRTextureTransform, Material } from '../GltfFormat';

/**
 * The first `KHR_texture_transform` on any texture the material uses
 *
 * glTF puts the transform on each texture reference, but a material here has one UV transform for
 * all its textures, so the first one found applies to every texture. Different transforms on
 * different textures are not supported. The list covers every texture passed to `Material3D`, so a
 * transform declared only on, say, a clearcoat texture still applies.
 * @param rawMaterial - The glTF material
 */
function extractUvTransform(rawMaterial: Material): KHRTextureTransform | undefined {
  const pbr = rawMaterial.pbrMetallicRoughness;
  const ext = rawMaterial.extensions;
  const candidates = [
    pbr?.baseColorTexture,
    pbr?.metallicRoughnessTexture,
    rawMaterial.normalTexture,
    rawMaterial.occlusionTexture,
    rawMaterial.emissiveTexture,
    ext?.KHR_materials_transmission?.transmissionTexture,
    ext?.KHR_materials_volume?.thicknessTexture,
    ext?.KHR_materials_clearcoat?.clearcoatTexture,
    ext?.KHR_materials_clearcoat?.clearcoatRoughnessTexture,
    ext?.KHR_materials_clearcoat?.clearcoatNormalTexture,
    ext?.KHR_materials_sheen?.sheenColorTexture,
    ext?.KHR_materials_sheen?.sheenRoughnessTexture,
    ext?.KHR_materials_specular?.specularTexture,
    ext?.KHR_materials_specular?.specularColorTexture,
    ext?.KHR_materials_iridescence?.iridescenceTexture,
    ext?.KHR_materials_iridescence?.iridescenceThicknessTexture,
    ext?.KHR_materials_anisotropy?.anisotropyTexture,
  ];
  for (const info of candidates) {
    const ktt = info?.extensions?.KHR_texture_transform;
    if (ktt) return ktt;
  }
  return undefined;
}

const TEXCOORD_ISSUE_URL = 'https://github.com/pixijs/pixi-3d/issues/57';
const warnedTexCoords = new Set<string>();

interface TextureBindingLike {
  texCoord?: number;
  extensions?: { KHR_texture_transform?: { texCoord?: number } };
}

/**
 * Warns when a texture asks for a UV set other than the first, once per texture slot and set
 *
 * Every texture samples UV set 0, which misdraws a texture made for set 1, such as the baked
 * occlusion map of many PBR exports. It also warns when a `KHR_texture_transform` names a different
 * set than its texture.
 * @param bindingName - The texture slot, for the message
 * @param info - The texture reference, when the material has one
 * @param materialName - The material's name, for the message
 */
function warnUnsupportedTexCoord(
  bindingName: string,
  info: TextureBindingLike | undefined,
  materialName: string,
): void {
  if (!info) return;

  const bindingTexCoord = info.texCoord ?? 0;
  if (bindingTexCoord !== 0) {
    const key = `binding:${bindingName}:${bindingTexCoord}`;
    if (!warnedTexCoords.has(key)) {
      warnedTexCoords.add(key);
      warn(
        `[pixi-3d] ${bindingName} on material "${materialName}" uses texCoord=${bindingTexCoord}; ` +
          `multi-UV-set support is not yet implemented and the texture will sample from UV0 ` +
          `(may apply to other materials in this asset). See ${TEXCOORD_ISSUE_URL}.`,
      );
    }
  }

  const transformTexCoord = info.extensions?.KHR_texture_transform?.texCoord;
  if (transformTexCoord !== undefined && transformTexCoord !== bindingTexCoord) {
    const key = `transform:${bindingName}:${transformTexCoord}`;
    if (!warnedTexCoords.has(key)) {
      warnedTexCoords.add(key);
      warn(
        `[pixi-3d] KHR_texture_transform on ${bindingName} (material "${materialName}") overrides ` +
          `texCoord (binding=${bindingTexCoord}, transform=${transformTexCoord}); per-binding ` +
          `texCoord overrides are not supported and the binding's texCoord will be used instead. ` +
          `See ${TEXCOORD_ISSUE_URL}.`,
      );
    }
  }
}

function warnUnsupportedPbrTexCoords(rawMaterial: Material): void {
  const name = rawMaterial.name ?? '<unnamed>';
  const pbr = rawMaterial.pbrMetallicRoughness;
  warnUnsupportedTexCoord('baseColorTexture', pbr?.baseColorTexture, name);
  warnUnsupportedTexCoord('metallicRoughnessTexture', pbr?.metallicRoughnessTexture, name);
  warnUnsupportedTexCoord('normalTexture', rawMaterial.normalTexture, name);
  warnUnsupportedTexCoord('occlusionTexture', rawMaterial.occlusionTexture, name);
  warnUnsupportedTexCoord('emissiveTexture', rawMaterial.emissiveTexture, name);
  warnUnsupportedTexCoord(
    'transmissionTexture',
    rawMaterial.extensions?.KHR_materials_transmission?.transmissionTexture,
    name,
  );
  warnUnsupportedTexCoord('thicknessTexture', rawMaterial.extensions?.KHR_materials_volume?.thicknessTexture, name);
  warnUnsupportedTexCoord('clearcoatTexture', rawMaterial.extensions?.KHR_materials_clearcoat?.clearcoatTexture, name);
  warnUnsupportedTexCoord(
    'clearcoatRoughnessTexture',
    rawMaterial.extensions?.KHR_materials_clearcoat?.clearcoatRoughnessTexture,
    name,
  );
  warnUnsupportedTexCoord(
    'clearcoatNormalTexture',
    rawMaterial.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture,
    name,
  );
  warnUnsupportedTexCoord('sheenColorTexture', rawMaterial.extensions?.KHR_materials_sheen?.sheenColorTexture, name);
  warnUnsupportedTexCoord(
    'sheenRoughnessTexture',
    rawMaterial.extensions?.KHR_materials_sheen?.sheenRoughnessTexture,
    name,
  );
  warnUnsupportedTexCoord('specularTexture', rawMaterial.extensions?.KHR_materials_specular?.specularTexture, name);
  warnUnsupportedTexCoord(
    'specularColorTexture',
    rawMaterial.extensions?.KHR_materials_specular?.specularColorTexture,
    name,
  );
  warnUnsupportedTexCoord(
    'anisotropyTexture',
    rawMaterial.extensions?.KHR_materials_anisotropy?.anisotropyTexture,
    name,
  );
}

function warnUnsupportedUnlitTexCoords(rawMaterial: Material): void {
  const name = rawMaterial.name ?? '<unnamed>';
  warnUnsupportedTexCoord('baseColorTexture', rawMaterial.pbrMetallicRoughness?.baseColorTexture, name);
}

/**
 * The matrix `BaseMaterial3D.uvTransform` takes for a `KHR_texture_transform`
 *
 * It equals `new Matrix().scale(sx, sy).rotate(rotation).translate(ox, oy)`, written out. The
 * shader applies it transposed (see the `uvTransform` setter), so the rotation turns the way the
 * Khronos sample renderer turns it, the opposite of the GLSL snippet in the extension's README.
 * @param ktt - The texture transform
 */
function buildUvTransformMatrix(ktt: KHRTextureTransform): Matrix {
  const [ox, oy] = ktt.offset ?? [0, 0];
  const [sx, sy] = ktt.scale ?? [1, 1];
  const rot = ktt.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return new Matrix(sx * cos, sx * sin, -sy * sin, sy * cos, ox, oy);
}

function gltfAlphaMode(rawMaterial: Material): BaseMaterial3DOptions['alphaMode'] {
  return rawMaterial.alphaMode === 'BLEND' ? 'blend' : rawMaterial.alphaMode === 'MASK' ? 'mask' : 'opaque';
}

/**
 * Encodes a linear RGB colour to sRGB
 *
 * glTF colour factors and `KHR_lights_punctual` colours are linear, while material and light
 * colours are set in sRGB and decoded when written. Encoding first lands the file's value on the
 * GPU. The result stays a float triple, so nothing is rounded to 8 bits on the way.
 * @param rgb - Linear-light colour; only the first three components are read
 * @internal
 */
export function linearRgbToSrgb(rgb: number[]): [number, number, number] {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])];
}

/**
 * Builds a {@link FlatMaterial} for a `KHR_materials_unlit` material
 *
 * An unlit material uses only its base colour and base colour texture, alpha mode, alpha cutoff and
 * double-sidedness, and ignores everything else. So only the base colour texture's
 * `KHR_texture_transform` applies, where the PBR path takes the first transform on any texture.
 * @param rawMaterial - The glTF material
 * @param source - Supplies the textures the material refers to
 */
function processUnlitMaterial(rawMaterial: Material, source: Scene3DSource): FlatMaterial {
  warnUnsupportedUnlitTexCoords(rawMaterial);

  const options: BaseMaterial3DOptions = {
    alphaMode: gltfAlphaMode(rawMaterial),
    alphaCutoff: rawMaterial.alphaCutoff,
    doubleSided: rawMaterial.doubleSided ?? false,
  };

  const pbr = rawMaterial.pbrMetallicRoughness;
  if (pbr?.baseColorFactor !== undefined) {
    options.baseColor = linearRgbToSrgb(pbr.baseColorFactor);
    options.alpha = pbr.baseColorFactor[3];
  }
  if (pbr?.baseColorTexture !== undefined) {
    options.baseColorTexture = source.textures[pbr.baseColorTexture.index];
  }

  const ktt = pbr?.baseColorTexture?.extensions?.KHR_texture_transform;
  if (ktt) options.uvTransform = buildUvTransformMatrix(ktt as KHRTextureTransform);

  const material = new FlatMaterial(options);

  material.vertexColors = true;

  return material;
}

/**
 * Builds a {@link Material3D} for a glTF material that isn't unlit
 *
 * Every value the file leaves out gets its glTF default, passed explicitly, because `Material3D`
 * defaults differ: metallic is 0, and an extension group, which its presence switches on, starts
 * visibly on at factor 1 or white. An extension that would draw nothing creates no group: emissive
 * strength without an emissive colour or texture, or a volume without transmission.
 *
 * Where an extension has two textures, `Material3D` packs them into one slot and keeps one (see
 * {@link SpecularOptions}, {@link SheenOptions} and {@link IridescenceOptions}). A file that binds
 * two different images gets a warning.
 *
 * With transmission, alpha mode `BLEND` or `MASK` becomes `OPAQUE`, with a warning, because the
 * transmission pass draws the see-through itself. Blending would also turn depth writes off, and a
 * double-sided transmissive mesh would then draw its front and back triangles in no set order and
 * show stripes.
 * @param rawMaterial - The glTF material
 * @param source - Supplies the textures the material refers to
 */
function processPbrMaterial(rawMaterial: Material, source: Scene3DSource): Material3D {
  warnUnsupportedPbrTexCoords(rawMaterial);

  const options: Partial<Material3DOptions> = {
    alphaMode: gltfAlphaMode(rawMaterial),
    alphaCutoff: rawMaterial.alphaCutoff,
    doubleSided: rawMaterial.doubleSided ?? false,
    metallic: 1,
    roughness: 1,
  };

  if (rawMaterial.normalTexture !== undefined) {
    options.normalTexture = source.textures[rawMaterial.normalTexture.index];
    if (rawMaterial.normalTexture.scale !== undefined) {
      options.normalScale = rawMaterial.normalTexture.scale;
    }
  }

  if (rawMaterial.emissiveFactor || rawMaterial.emissiveTexture) {
    const emissive: EmissiveOptions = {
      color: linearRgbToSrgb(rawMaterial.emissiveFactor ?? [0, 0, 0]),
      strength: rawMaterial.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
    };
    if (rawMaterial.emissiveTexture) {
      emissive.texture = source.textures[rawMaterial.emissiveTexture.index];
    }
    options.emissive = emissive;
  }

  if (rawMaterial.occlusionTexture) {
    options.occlusionTexture = source.textures[rawMaterial.occlusionTexture.index];
    if (rawMaterial.occlusionTexture.strength !== undefined) {
      options.occlusionStrength = rawMaterial.occlusionTexture.strength;
    }
  }

  if (rawMaterial.pbrMetallicRoughness) {
    const pbr = rawMaterial.pbrMetallicRoughness;

    if (pbr.baseColorFactor !== undefined) {
      options.baseColor = linearRgbToSrgb(pbr.baseColorFactor);
      options.alpha = pbr.baseColorFactor[3];
    }
    if (pbr.metallicFactor !== undefined) options.metallic = pbr.metallicFactor;
    if (pbr.roughnessFactor !== undefined) options.roughness = pbr.roughnessFactor;

    if (pbr.baseColorTexture !== undefined) {
      options.baseColorTexture = source.textures[pbr.baseColorTexture.index];
    }

    if (pbr.metallicRoughnessTexture !== undefined)
      options.metallicRoughnessTexture = source.textures[pbr.metallicRoughnessTexture.index];
  }

  const ktt = extractUvTransform(rawMaterial);
  if (ktt) options.uvTransform = buildUvTransformMatrix(ktt);

  const transmissionExt = rawMaterial.extensions?.KHR_materials_transmission;
  if (transmissionExt) {
    const transmission: TransmissionOptions = { factor: transmissionExt.transmissionFactor ?? 0 };
    if (transmissionExt.transmissionTexture) {
      transmission.texture = source.textures[transmissionExt.transmissionTexture.index];
    }

    const volume = rawMaterial.extensions?.KHR_materials_volume;
    if (volume) {
      transmission.thickness = volume.thicknessFactor ?? 0;
      transmission.attenuationDistance = volume.attenuationDistance ?? Infinity;
      transmission.attenuationColor = linearRgbToSrgb(volume.attenuationColor ?? [1, 1, 1]);
      if (volume.thicknessTexture) {
        transmission.thicknessTexture = source.textures[volume.thicknessTexture.index];
      }
    }

    options.transmission = transmission;

    const hasTransmission = (transmission.factor ?? 0) > 0 || transmission.texture !== undefined;
    if (hasTransmission && options.alphaMode !== 'opaque') {
      warn(
        `[pixi-3d] Material "${rawMaterial.name ?? '<unnamed>'}" combines KHR_materials_transmission ` +
          `with alphaMode="${rawMaterial.alphaMode ?? 'OPAQUE'}"; the glTF spec leaves this undefined. ` +
          `Coercing alphaMode to OPAQUE so the transmission pass handles transparency.`,
      );
      options.alphaMode = 'opaque';
    }
  }

  const iorExt = rawMaterial.extensions?.KHR_materials_ior;
  if (iorExt) {
    options.ior = iorExt.ior ?? 1.5;
  }

  const iridescence = rawMaterial.extensions?.KHR_materials_iridescence;
  if (iridescence) {
    const irid: IridescenceOptions = {
      factor: iridescence.iridescenceFactor ?? 0,
      ior: iridescence.iridescenceIor ?? 1.3,
      thicknessMinimum: iridescence.iridescenceThicknessMinimum ?? 100,
      thicknessMaximum: iridescence.iridescenceThicknessMaximum ?? 400,
    };
    const factorIdx = iridescence.iridescenceTexture?.index;
    const thickIdx = iridescence.iridescenceThicknessTexture?.index;
    if (factorIdx !== undefined) irid.texture = source.textures[factorIdx];
    if (thickIdx !== undefined) irid.thicknessTexture = source.textures[thickIdx];
    options.iridescence = irid;
    if (factorIdx !== undefined && thickIdx !== undefined && factorIdx !== thickIdx) {
      warn(
        `[pixi-3d] KHR_materials_iridescence on material "${rawMaterial.name ?? '<unnamed>'}" references ` +
          `two different textures for iridescenceTexture (R=factor) and iridescenceThicknessTexture ` +
          `(G=thickness); pixi-3d packs both into one slot (R+G). The factor texture will be used and ` +
          `iridescence thickness will be sampled from its G channel. Repack into a single image with ` +
          `factor in R and thickness in G for the intended look.`,
      );
    }
  }

  const clearcoat = rawMaterial.extensions?.KHR_materials_clearcoat;
  if (clearcoat) {
    const cc: ClearcoatOptions = {
      factor: clearcoat.clearcoatFactor ?? 0,
      roughness: clearcoat.clearcoatRoughnessFactor ?? 0,
    };
    if (clearcoat.clearcoatTexture) {
      cc.texture = source.textures[clearcoat.clearcoatTexture.index];
    }
    if (clearcoat.clearcoatRoughnessTexture) {
      cc.roughnessTexture = source.textures[clearcoat.clearcoatRoughnessTexture.index];
    }
    if (clearcoat.clearcoatNormalTexture) {
      cc.normalTexture = source.textures[clearcoat.clearcoatNormalTexture.index];
      if (clearcoat.clearcoatNormalTexture.scale !== undefined) {
        cc.normalScale = clearcoat.clearcoatNormalTexture.scale;
      }
    }
    options.clearcoat = cc;
  }

  const sheen = rawMaterial.extensions?.KHR_materials_sheen;
  if (sheen) {
    const sh: SheenOptions = {
      color: linearRgbToSrgb(sheen.sheenColorFactor ?? [0, 0, 0]),
      roughness: sheen.sheenRoughnessFactor ?? 0,
    };
    const colorIdx = sheen.sheenColorTexture?.index;
    const roughIdx = sheen.sheenRoughnessTexture?.index;
    if (colorIdx !== undefined) sh.texture = source.textures[colorIdx];
    if (roughIdx !== undefined) sh.roughnessTexture = source.textures[roughIdx];
    options.sheen = sh;
    if (colorIdx !== undefined && roughIdx !== undefined && colorIdx !== roughIdx) {
      warn(
        `[pixi-3d] KHR_materials_sheen on material "${rawMaterial.name ?? '<unnamed>'}" references two ` +
          `different textures for sheenColor and sheenRoughness; pixi-3d packs both into one slot (RGB+A). ` +
          `The colour texture will be used and sheen roughness will be sampled from its alpha channel ` +
          `(usually 1.0 on an sRGB colour texture, effectively giving factor-only roughness). Repack into ` +
          `a single RGBA image with roughness in alpha for the intended look.`,
      );
    }
  }

  const specular = rawMaterial.extensions?.KHR_materials_specular;
  if (specular) {
    const spec: SpecularOptions = {
      factor: specular.specularFactor ?? 1,
      color: linearRgbToSrgb(specular.specularColorFactor ?? [1, 1, 1]),
    };
    const colorIdx = specular.specularColorTexture?.index;
    const factorIdx = specular.specularTexture?.index;
    if (colorIdx !== undefined) spec.colorTexture = source.textures[colorIdx];
    if (factorIdx !== undefined) spec.texture = source.textures[factorIdx];
    options.specular = spec;
    if (colorIdx !== undefined && factorIdx !== undefined && colorIdx !== factorIdx) {
      warn(
        `[pixi-3d] KHR_materials_specular on material "${rawMaterial.name ?? '<unnamed>'}" references two ` +
          `different textures for specularColor (RGB) and specular (A); pixi-3d packs both into one slot ` +
          `(RGB+A). The colour texture will be used and specular factor will be sampled from its alpha ` +
          `channel (usually 1.0 on an sRGB colour texture, effectively giving factor-only strength). ` +
          `Repack into a single RGBA image with factor in alpha for the intended look.`,
      );
    }
  }

  const anisotropy = rawMaterial.extensions?.KHR_materials_anisotropy;
  if (anisotropy) {
    const aniso: AnisotropyOptions = {
      strength: anisotropy.anisotropyStrength ?? 0,
      rotation: anisotropy.anisotropyRotation ?? 0,
    };
    const texIdx = anisotropy.anisotropyTexture?.index;
    if (texIdx !== undefined) aniso.texture = source.textures[texIdx];
    options.anisotropy = aniso;
  }

  const material = new Material3D(options);

  material.vertexColors = true;

  return material;
}

/**
 * Converts one glTF material into a runtime material: a `FlatMaterial` when it's unlit, a
 * `Material3D` otherwise
 *
 * Either way it turns {@link BaseMaterial3D#vertexColors} on, because glTF multiplies the base
 * colour by `COLOR_0`.
 * @param rawMaterial - The glTF material to convert
 * @param source - Supplies the already-processed textures the material references
 * @internal
 */
export function processMaterial(rawMaterial: Material, source: Scene3DSource): BaseMaterial3D {
  if (rawMaterial.extensions?.KHR_materials_unlit) {
    return processUnlitMaterial(rawMaterial, source);
  }
  return processPbrMaterial(rawMaterial, source);
}

/**
 * Converts every glTF material and stores it on the source by index and name
 *
 * When a mesh primitive names no material, one unnamed glTF default material (white, fully
 * metallic, fully rough, opaque, single-sided) is added in the slot after the file's own
 * materials, and every such primitive shares it; `processNodes` points them there.
 * @param gltfRaw - Parsed glTF JSON
 * @param source - Receives the materials and supplies the already-processed textures they reference
 * @internal
 */
export function processMaterials(gltfRaw: GltfFormat, source: Scene3DSource): void {
  const rawMaterials = gltfRaw.materials ?? [];

  rawMaterials.forEach((rawMaterial, index) => {
    const material = processMaterial(rawMaterial, source);

    source.materials[index] = material;

    if (rawMaterial.name) {
      source.material[rawMaterial.name] = material;
    }
  });

  if (gltfRaw.meshes?.some((mesh) => mesh.primitives.some((p) => p.material === undefined))) {
    source.materials[rawMaterials.length] = new Material3D({ metallic: 1, roughness: 1 });
  }
}
