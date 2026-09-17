import { Color, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { NORMAL_MAP } from '~/core/textures/DefaultTextures';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Material3DOptions } from '~/materials/pbr/Material3D';
import { collectTextureNames, validateMaterialTextureSlots } from '~/materials/utils/validateMaterialTextureSlots';
import { View3D } from '~/scene/View3D';

const makeView = () => new View3D({ width: 64, height: 64 });
const makeTexture = () => new Texture({ source: new TextureSource({ width: 1, height: 1 }) });

/** The six optional Material3D features and a minimal option set that enables each. */
const FEATURES: { name: string; options: Material3DOptions; textures: string[] }[] = [
  { name: 'emissive', options: { emissive: { color: 0xff0000 } }, textures: ['emissive'] },
  { name: 'specular', options: { specular: { factor: 0.5 } }, textures: ['specular'] },
  { name: 'iridescence', options: { iridescence: { factor: 0.5 } }, textures: ['iridescence'] },
  { name: 'transmission', options: { transmission: { factor: 0.5 } }, textures: ['transmission', 'thickness'] },
  {
    name: 'clearcoat',
    // Empty group — presence alone is the gate. With no coat normal map this is
    // the cheap variant, so no clearcoatNormal slot (see clearcoatBit.ts).
    options: { clearcoat: {} },
    textures: ['clearcoat', 'clearcoatRoughness'],
  },
  { name: 'sheen', options: { sheen: { color: 0xffffff } }, textures: ['sheen'] },
];

const BASE_TEXTURES = ['baseColor', 'metallicRoughness', 'occlusion', 'normal'];

describe('Material3D texture slot derivation', () => {
  it('derives slots matching the descriptor walk for every feature combination', () => {
    const view = makeView();

    // All 2^6 combinations of the optional features.
    for (let mask = 0; mask < 1 << FEATURES.length; mask++) {
      const options: Material3DOptions = {};
      const expectedNames = [...BASE_TEXTURES];

      for (let f = 0; f < FEATURES.length; f++) {
        if (!(mask & (1 << f))) continue;
        Object.assign(options, FEATURES[f].options);
        expectedNames.push(...FEATURES[f].textures);
      }

      const material = new Material3D(options);
      const descriptor = material.getPrimaryDescriptor(view);

      // The derived array covers exactly the declared names, in walk order.
      expect(collectTextureNames(descriptor.bitsGpu)).toEqual(expectedNames);
      expect(material._textures.length).toBe(expectedNames.length);
      for (let i = 0; i < expectedNames.length; i++) {
        expect(material._slotByName[expectedNames[i]]).toBe(i);
      }

      // The shader-build guard agrees, on both backends' bit lists.
      expect(() => validateMaterialTextureSlots(descriptor.bitsGpu, material)).not.toThrow();
      expect(() => validateMaterialTextureSlots(descriptor.bitsGl, material)).not.toThrow();
    }
  });

  it('applies presence defaults: empty groups are visibly on', () => {
    // Opening a group with no values means "on, with defaults".
    const transmissive = new Material3D({ transmission: {} });
    expect(transmissive.transmission!.factor).toBe(1);

    // Colour defaults to white so texture-only emissive renders as authored.
    const emissiveTexture = makeTexture();
    const grouped = new Material3D({ emissive: { texture: emissiveTexture, strength: 5 } });
    expect(grouped.emissive!.texture).toBe(emissiveTexture);
    expect(grouped.emissive!.strength).toBe(5);
    expect(grouped.emissive!.color).toBe(0xffffff);

    // `color` takes any ColorSource shape.
    for (const color of [0xff0000, 'red', [1, 0, 0], { r: 255, g: 0, b: 0 }, new Color(0xff0000)]) {
      const material = new Material3D({ emissive: { color } });
      expect(material.emissive!.color).toBe(0xff0000);
    }
  });

  it('gates features on group presence alone', () => {
    const view = makeView();

    // Zero-valued members no longer drop the feature…
    const explicit = new Material3D({ clearcoat: { factor: 0 }, sheen: { color: 0x000000 } });
    const slots = collectTextureNames(explicit.getPrimaryDescriptor(view).bitsGpu);
    expect(slots).toContain('clearcoat');
    expect(slots).toContain('sheen');

    // …and absence allocates nothing.
    const plain = new Material3D({ roughness: 0.5 });
    expect(plain._textures.length).toBe(4);
  });

  it('resolves option textures and per-name fallbacks', () => {
    const specularColorTexture = makeTexture();
    const specularTexture = makeTexture();
    const iridescenceThicknessTexture = makeTexture();

    const material = new Material3D({
      clearcoat: {},
      specular: { colorTexture: specularColorTexture, texture: specularTexture },
      iridescence: { thicknessTexture: iridescenceThicknessTexture },
    });

    // Pick preference: colour texture wins over the factor texture.
    expect(material.specular!.texture).toBe(specularColorTexture);
    // Single-slot packing fallback: thickness texture fills the iridescence slot.
    expect(material.iridescence!.texture).toBe(iridescenceThicknessTexture);
    // Normal-style slots default to the flat NORMAL_MAP, everything else to WHITE.
    expect(material.textures.normal).toBe(NORMAL_MAP);
    // A clearcoat with no coat normal map allocates no clearcoatNormal slot.
    expect(material.textures.clearcoatNormal).toBeUndefined();
    expect(material.clearcoat!.texture).toBe(Texture.WHITE);
    expect(material.textures.baseColor).toBe(Texture.WHITE);
  });

  it('allocates the coat-normal slot only when a clearcoat normal map is supplied', () => {
    const clearcoatNormal = makeTexture();
    const mapped = new Material3D({ clearcoat: { normalTexture: clearcoatNormal } });

    expect(mapped.textures.clearcoatNormal).toBe(clearcoatNormal);
    // The read-only prop reflects the construction-fixed slot.
    expect(mapped.clearcoat!.normalTexture).toBe(clearcoatNormal);

    const plain = new Material3D({ clearcoat: {} });

    expect(plain.textures.clearcoatNormal).toBeUndefined();
    expect(plain.clearcoat!.normalTexture).toBeUndefined();
  });

  it('exposes no feature props for groups the material never opted into', () => {
    const material = new Material3D({});

    expect(material.transmission).toBeUndefined();
    expect(material.sheen).toBeUndefined();
    expect(material.emissive).toBeUndefined();
    expect(material.clearcoat).toBeUndefined();
    // The sealed textures object rejects unallocated slots loudly.
    expect(() => ((material.textures as Record<string, Texture>).transmission = makeTexture())).toThrow(
      /not extensible|add property/i,
    );
  });

  it('gives FlatMaterial extraBits first-class texture slots', () => {
    const view = makeView();
    const noise = makeTexture();
    const noiseBit: ShaderBit = { name: 'noise', textures: ['noise'] };

    const material = new FlatMaterial({ extraBits: [noiseBit], textures: { noise } });

    expect(material._slotByName).toEqual({ baseColor: 0, noise: 1 });
    expect(material._textures[0]).toBe(Texture.WHITE);
    expect(material._textures[1]).toBe(noise);

    const descriptor = material.getPrimaryDescriptor(view);
    expect(() => validateMaterialTextureSlots(descriptor.bitsGpu, material)).not.toThrow();
  });

  it('derives raw-descriptor materials from their own bits via the name-keyed textures option', () => {
    const albedo = makeTexture();
    const customBit: ShaderBit = { name: 'custom', textures: ['albedo', 'mask'] };

    const material = new BaseMaterial3D({
      descriptor: { bitsGpu: [customBit], bitsGl: [customBit] },
      textures: { albedo },
    });

    expect(material._slotByName).toEqual({ albedo: 0, mask: 1 });
    expect(material._textures[0]).toBe(albedo);
    expect(material._textures[1]).toBe(Texture.WHITE);

    // Custom materials swap their own slots at runtime by name.
    const replacement = makeTexture();
    material.textures.mask = replacement;
    expect(material.textures.mask).toBe(replacement);
    expect(() => ((material.textures as Record<string, Texture>).nope = replacement)).toThrow(
      /not extensible|add property/i,
    );
  });

  it('throws when a descriptor duplicates a texture name across bits', () => {
    const a: ShaderBit = { name: 'a', textures: ['shared'] };
    const b: ShaderBit = { name: 'b', textures: ['shared'] };

    expect(() => new BaseMaterial3D({ descriptor: { bitsGpu: [a, b], bitsGl: [a, b] } })).toThrow(/Duplicate texture/);
  });

  it('throws when bitsGl and bitsGpu declare different texture sequences', () => {
    const gpuBit: ShaderBit = { name: 'x', textures: ['one'] };
    const glBit: ShaderBit = { name: 'y', textures: ['two'] };

    expect(() => new BaseMaterial3D({ descriptor: { bitsGpu: [gpuBit], bitsGl: [glBit] } })).toThrow(/must match/);
  });

  it('validateMaterialTextureSlots rejects bit lists that diverge from the derived slots', () => {
    const material = new Material3D({});
    const intruder: ShaderBit = { name: 'intruder', textures: ['sneaky'] };
    const view = makeView();
    const bits = [...material.getPrimaryDescriptor(view).bitsGpu];

    // A texture-bearing bit prepended outside the derivation shifts every
    // sample index — exactly the drift the guard exists to catch. A trailing
    // one fails the same way (its name has no derived slot).
    expect(() => validateMaterialTextureSlots([intruder, ...bits], material)).toThrow(/do not match/);
    expect(() => validateMaterialTextureSlots([...bits, intruder], material)).toThrow(/do not match/);

    // The count check fires in the opposite direction: the material derived
    // more slots than the compiled bit list declares (a dropped bit).
    const transmissive = new Material3D({ transmission: { factor: 0.5 } });
    const missingBits = transmissive.getPrimaryDescriptor(view).bitsGpu.filter((b) => b.name !== 'transmission');
    expect(() => validateMaterialTextureSlots(missingBits, transmissive)).toThrow(/derive together/);
  });
});

describe('material.textures — keyed slot surface', () => {
  it('mirrors _textures by name and routes writes through the canonical slot swap', () => {
    const material = new Material3D({ emissive: {} });
    const texture = makeTexture();

    expect(material.textures.baseColor).toBe(material._textures[material._slotByName.baseColor]);

    material['_textureCacheKey'] = 0;
    material.textures.emissive = texture;

    expect(material.textures.emissive).toBe(texture);
    expect(material.emissive!.texture).toBe(texture);
    expect(material['_textureCacheKey']).toBe(-1);
  });

  it('routes a normal-map swap through the canonical slot path, not special variant bookkeeping', () => {
    const material = new Material3D({});
    material['_textureCacheKey'] = 0;
    material['_variantDirty'] = false;

    material.textures.normal = makeTexture();

    // The normal slot dirties like any other slot — `_textureCacheKey → -1` drives `_batchDirty` and the
    // recompile; the normal-mapping variant is then selected live in `ensureMaterial`. So the slot
    // write does NOT touch `_variantDirty`. (The end-to-end recompile is proven in normalMapVariant.test.ts.)
    expect(material['_textureCacheKey']).toBe(-1);
    expect(material['_variantDirty']).toBe(false);
  });

  it('throws on a typo’d slot write instead of silently holding a texture', () => {
    const material = new Material3D({});
    expect(() => ((material.textures as Record<string, Texture>).bogus = makeTexture())).toThrow(
      /not extensible|add property/i,
    );
  });
});
