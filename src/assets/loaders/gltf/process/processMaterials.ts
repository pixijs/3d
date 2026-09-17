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

// KHR_texture_transform is per-TextureInfo in the spec, but our material model
// has a single per-material UV transform applied in the vertex shader — so any
// texture slot that declares the extension contributes the same transform to
// all texture reads on this material. Picks the first slot that has it.
//
// The candidate list must include every texture slot this loader forwards to
// Material3D — otherwise a material that declares KHR_texture_transform only
// on, say, clearcoat slots would have its transform silently dropped even
// though the shader would honour it if extracted. Per-slot divergent
// transforms are still unsupported (single-per-material model); this just
// ensures the single transform is found wherever it's declared.
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

// Tracked in https://github.com/pixijs/pixi-3d/issues/57.
//
// Until per-binding `texCoord` routing lands we sample everything from UV0,
// which silently misrenders any binding that asks for `texCoord = 1` (common
// in baked-AO PBR exports and Khronos sample assets like BoomBox). Warn at
// load time so users get an actionable log line instead of debugging a subtle
// visual bug. Deduplicated by (binding, texCoord) across the load to avoid
// spamming scenes with many materials that share the same issue.
const TEXCOORD_ISSUE_URL = 'https://github.com/pixijs/pixi-3d/issues/57';
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

// Builds the affine matrix the shader expects from a parsed KHR_texture_transform.
// Equivalent to `new Matrix().scale(sx, sy).rotate(rot).translate(ox, oy)` but
// built explicitly to remove any ambiguity in Pixi's chain order. The shader
// reads row0 row-major (see BaseMaterial3D.uvTransform setter), so this affine
// follows the de-facto KHR_texture_transform convention (visual CCW rotation in
// y-down UV).
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
 * Converts a linear-light RGB triple to the sRGB display domain
 *
 * glTF factor colours (`baseColorFactor`, `emissiveFactor`, `attenuationColor`,
 * `sheenColorFactor`, `specularColorFactor`) are linear per spec, while the
 * material API's `ColorSource` inputs follow Pixi's display-space convention
 * and are sRGB-decoded at write. Pre-encoding here makes the round trip land
 * the spec value on the GPU (round-trip error < 1e-6). A working-space-aware
 * colour pipeline would obsolete this hop.
 *
 * Shared by `processLights` — KHR_lights_punctual colours are linear per spec too.
 * @param rgb - Linear-light colour; only the first three components are read
 * @internal
 */
export function linearRgbToSrgb(rgb: number[]): [number, number, number] {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])];
}

// KHR_materials_unlit: presence-only extension. Per spec, only baseColorFactor,
// baseColorTexture, alphaMode, alphaCutoff and doubleSided are honoured — every
// other core PBR field and KHR material extension is ignored. We instantiate
// FlatMaterial (which uses flatMaterialBit and skips all PBR/IBL/lighting
// shader work) rather than a runtime branch in Material3D.
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

  // Per KHR_materials_unlit spec, only baseColorTexture's KHR_texture_transform
  // applies — other bindings are ignored entirely, so we must not inherit their
  // transforms (unlike the PBR path, which fans out across all slots).
  const ktt = pbr?.baseColorTexture?.extensions?.KHR_texture_transform;
  if (ktt) options.uvTransform = buildUvTransformMatrix(ktt as KHRTextureTransform);

  const material = new FlatMaterial(options);

  // See the PBR path — glTF's COLOR_0 tints, so loaded materials opt in.
  material.vertexColors = true;

  return material;
}

function processPbrMaterial(rawMaterial: Material, source: Scene3DSource): Material3D {
  warnUnsupportedPbrTexCoords(rawMaterial);

  const options: Partial<Material3DOptions> = {
    alphaMode: gltfAlphaMode(rawMaterial),
    alphaCutoff: rawMaterial.alphaCutoff,
    doubleSided: rawMaterial.doubleSided ?? false,
  };

  if (rawMaterial.normalTexture !== undefined) {
    options.normalTexture = source.textures[rawMaterial.normalTexture.index];
    // glTF 2.0 spec: normalTextureInfo.scale defaults to 1.0 when unspecified.
    if (rawMaterial.normalTexture.scale !== undefined) {
      options.normalScale = rawMaterial.normalTexture.scale;
    }
  }

  // Core emissive + KHR_materials_emissive_strength, fused into one group.
  // Spec default emissiveFactor is [0, 0, 0] — passed explicitly, since the
  // constructor's presence default is white. A strength extension without a
  // colour or texture is inert per spec (black × anything) so no group is
  // created for it.
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
    // glTF 2.0 spec defaults both factors to 1.0 when unspecified — pin
    // them explicitly so the loader stays spec-compliant whatever the
    // Material3D constructor's default is.
    options.metallic = pbr.metallicFactor ?? 1;
    options.roughness = pbr.roughnessFactor ?? 1;

    if (pbr.baseColorTexture !== undefined) {
      options.baseColorTexture = source.textures[pbr.baseColorTexture.index];
    }

    if (pbr.metallicRoughnessTexture !== undefined)
      options.metallicRoughnessTexture = source.textures[pbr.metallicRoughnessTexture.index];
  }

  const ktt = extractUvTransform(rawMaterial);
  if (ktt) options.uvTransform = buildUvTransformMatrix(ktt);

  // --- KHR_materials_transmission + KHR_materials_volume ---
  // pixi-3d fuses the pair into one `transmission` group. A volume extension
  // without transmission has no supported consumer (no diffuse transmission)
  // and was already inert, so no group is created for it.
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

    // KHR_materials_transmission leaves alphaMode BLEND/MASK as undefined —
    // the transmission pass already composites see-through via its own
    // mix(albedo, transmittedColor, effectiveTx). Leaving alphaMode='blend'
    // also toggles state.blend / state.depthMask in the material setter,
    // which then leaks into the transmission pass: no depth writes means
    // doubleSided meshes render front/back triangles in undefined order,
    // producing latitude-ring striping at grazing view angles. Matches the
    // Khronos sample renderer's behaviour of treating transmission as its
    // own transparency pathway. We still honour the author's doubleSided
    // and alphaCutoff fields.
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

  // --- KHR_materials_ior ---
  const iorExt = rawMaterial.extensions?.KHR_materials_ior;
  if (iorExt) {
    options.ior = iorExt.ior ?? 1.5;
  }

  // --- KHR_materials_iridescence ---
  // The spec exposes iridescenceTexture (R = factor) and iridescenceThicknessTexture
  // (G = thickness) as separate bindings, but they almost always reference the
  // same packed image. pixi-3d uses a single texture slot (R + G) — see
  // Material3D.ts / iridescenceBit.ts. If a pathological asset binds two distinct
  // textures we warn and use the factor texture; its G channel then drives the
  // thickness lerp.
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

  // --- KHR_materials_clearcoat ---
  const clearcoat = rawMaterial.extensions?.KHR_materials_clearcoat;
  if (clearcoat) {
    // Spec defaults (factor 0, roughness 0) passed explicitly — the
    // constructor's presence default for `factor` is 1.
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

  // --- KHR_materials_sheen ---
  // The spec exposes sheenColorTexture (RGB) and sheenRoughnessTexture (A) as
  // separate bindings, but they almost always reference the same packed image.
  // pixi-3d uses a single texture slot (RGB + A) — see Material3D.ts. If a
  // pathological asset binds two distinct textures we warn and use the color
  // texture; roughness falls back to `sheenRoughnessFactor`.
  const sheen = rawMaterial.extensions?.KHR_materials_sheen;
  if (sheen) {
    // Spec defaults (colour black — lobe off — and roughness 0) passed
    // explicitly; the constructor's presence default for `color` is white.
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

  // --- KHR_materials_specular ---
  // The spec exposes specularTexture (A = factor) and specularColorTexture
  // (RGB = colour, sRGB) as separate bindings, but they almost always reference
  // the same packed image. pixi-3d uses a single texture slot (RGB + A) — see
  // Material3D.ts / specularBit.ts. If a pathological asset binds two distinct
  // textures we warn and use the colour texture; its alpha then drives factor.
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

  // --- KHR_materials_anisotropy ---
  // anisotropyTexture packs the per-texel fibre direction in RG (a [-1,1] vector
  // encoded to [0,1]) and the strength in B. Spec defaults (strength 0, rotation 0)
  // are passed explicitly; Material3D's presence default for `strength` is 1.
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

  // glTF defines COLOR_0 as multiplying base color, so materials loaded from a
  // glTF opt in even though the engine default is off. Hand-authored materials
  // keep the safe default; see `BaseMaterial3D.vertexColors`.
  material.vertexColors = true;

  return material;
}

/**
 * Converts one glTF material into a runtime material (unlit → `FlatMaterial`, PBR → `Material3D`)
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
 * @param gltfRaw - Parsed glTF JSON
 * @param source - Receives the materials and supplies the already-processed textures they reference
 * @internal
 */
export function processMaterials(gltfRaw: GltfFormat, source: Scene3DSource): void {
  if (gltfRaw.materials) {
    gltfRaw.materials.forEach((rawMaterial, index) => {
      const material = processMaterial(rawMaterial, source);

      source.materials[index] = material;

      if (rawMaterial.name) {
        source.material[rawMaterial.name] = material;
      }
    });
  }
}
