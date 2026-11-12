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
import type { GltfFormat } from '../GltfFormat';

/**
 * A material has one UV transform for all its textures, so this takes the first on any texture
 * `processPbrMaterial` sets; keep this list in step with it
 */
function extractUvTransform(rawMaterial: GltfFormat.Material): GltfFormat.KHRTextureTransform | undefined {
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

const warnedTexCoords = new Set<string>();

interface TextureBindingLike {
  texCoord?: number;
  extensions?: { KHR_texture_transform?: { texCoord?: number } };
}

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
        `[@pixi/3d] ${bindingName} on material "${materialName}" uses texCoord=${bindingTexCoord}; ` +
          `multi-UV-set support is not yet implemented and the texture will sample from UV0 ` +
          `(may apply to other materials in this asset).`,
      );
    }
  }

  const transformTexCoord = info.extensions?.KHR_texture_transform?.texCoord;
  if (transformTexCoord !== undefined && transformTexCoord !== bindingTexCoord) {
    const key = `transform:${bindingName}:${transformTexCoord}`;
    if (!warnedTexCoords.has(key)) {
      warnedTexCoords.add(key);
      warn(
        `[@pixi/3d] KHR_texture_transform on ${bindingName} (material "${materialName}") overrides ` +
          `texCoord (binding=${bindingTexCoord}, transform=${transformTexCoord}); per-binding ` +
          `texCoord overrides are not supported and the binding's texCoord will be used instead.`,
      );
    }
  }
}

function warnUnsupportedPbrTexCoords(rawMaterial: GltfFormat.Material): void {
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

function warnUnsupportedUnlitTexCoords(rawMaterial: GltfFormat.Material): void {
  const name = rawMaterial.name ?? '<unnamed>';
  warnUnsupportedTexCoord('baseColorTexture', rawMaterial.pbrMetallicRoughness?.baseColorTexture, name);
}

/**
 * The `KHR_texture_transform` matrix in the form `BaseMaterial3D.uvTransform` documents. It rotates as
 * the Khronos sample renderer does, the opposite of the GLSL in the extension's README
 */
function buildUvTransformMatrix(ktt: GltfFormat.KHRTextureTransform): Matrix {
  const [ox, oy] = ktt.offset ?? [0, 0];
  const [sx, sy] = ktt.scale ?? [1, 1];
  const rot = ktt.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return new Matrix(sx * cos, sx * sin, -sy * sin, sy * cos, ox, oy);
}

function gltfAlphaMode(rawMaterial: GltfFormat.Material): BaseMaterial3DOptions['alphaMode'] {
  return rawMaterial.alphaMode === 'BLEND' ? 'blend' : rawMaterial.alphaMode === 'MASK' ? 'mask' : 'opaque';
}

/**
 * Encodes glTF's linear colours to the sRGB that material and light colours decode, as floats, so
 * nothing rounds to 8 bits
 * @internal
 */
export function linearRgbToSrgb(rgb: number[]): [number, number, number] {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])];
}

function processUnlitMaterial(rawMaterial: GltfFormat.Material, source: Scene3DSource): FlatMaterial {
  warnUnsupportedUnlitTexCoords(rawMaterial);

  const options: BaseMaterial3DOptions = {
    alphaMode: gltfAlphaMode(rawMaterial),
    alphaCutoff: rawMaterial.alphaCutoff,
    doubleSided: rawMaterial.doubleSided ?? false,
    vertexColors: true,
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
  if (ktt) options.uvTransform = buildUvTransformMatrix(ktt);

  return new FlatMaterial(options);
}

/**
 * Passes every glTF default explicitly, as `Material3D`'s differ: metallic 0, and an extension group
 * switching on at factor 1
 */
function processPbrMaterial(rawMaterial: GltfFormat.Material, source: Scene3DSource): Material3D {
  warnUnsupportedPbrTexCoords(rawMaterial);

  const options: Partial<Material3DOptions> = {
    alphaMode: gltfAlphaMode(rawMaterial),
    alphaCutoff: rawMaterial.alphaCutoff,
    doubleSided: rawMaterial.doubleSided ?? false,
    metallic: 1,
    roughness: 1,
    vertexColors: true,
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
        `[@pixi/3d] Material "${rawMaterial.name ?? '<unnamed>'}" combines KHR_materials_transmission ` +
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
        `[@pixi/3d] KHR_materials_iridescence on material "${rawMaterial.name ?? '<unnamed>'}" references ` +
          `two different textures for iridescenceTexture (R=factor) and iridescenceThicknessTexture ` +
          `(G=thickness); PixiJS 3D packs both into one slot (R+G). The factor texture will be used and ` +
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
        `[@pixi/3d] KHR_materials_sheen on material "${rawMaterial.name ?? '<unnamed>'}" references two ` +
          `different textures for sheenColor and sheenRoughness; PixiJS 3D packs both into one slot (RGB+A). ` +
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
        `[@pixi/3d] KHR_materials_specular on material "${rawMaterial.name ?? '<unnamed>'}" references two ` +
          `different textures for specularColor (RGB) and specular (A); PixiJS 3D packs both into one slot ` +
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

  return new Material3D(options);
}

/** @internal */
export function processMaterial(rawMaterial: GltfFormat.Material, source: Scene3DSource): BaseMaterial3D {
  if (rawMaterial.extensions?.KHR_materials_unlit) {
    return processUnlitMaterial(rawMaterial, source);
  }
  return processPbrMaterial(rawMaterial, source);
}

/**
 * Adds the glTF default material after the file's own, at the index `processNodes` gives a
 * primitive with none
 * @internal
 */
export function processMaterials(gltfRaw: GltfFormat, source: Scene3DSource): void {
  const rawMaterials = gltfRaw.materials ?? [];

  rawMaterials.forEach((rawMaterial, index) => {
    const material = processMaterial(rawMaterial, source);

    material.label = rawMaterial.name;
    source.materials[index] = material;

    if (rawMaterial.name) {
      source.material[rawMaterial.name] = material;
    }
  });

  if (gltfRaw.meshes?.some((mesh) => mesh.primitives.some((p) => p.material === undefined))) {
    source.materials[rawMaterials.length] = new Material3D({ metallic: 1, roughness: 1 });
  }
}
