import { Matrix, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { materialStructSnapshot, mergeMaterialStruct } from '~/core/shader/codegen/materialStruct';
import { materialStructPackPlugin } from '~/core/shader/codegen/materialStructPackPlugin';
import type { ShaderBit, StructDefinition } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import type { PhongMaterialOptions } from '~/materials/phong/PhongMaterial';
import { validateMaterialStruct } from '~/materials/utils/validateMaterialTextureSlots';
import { View3D } from '~/scene/View3D';

const wgslTemplate: ShaderBitTemplate = { bindGroups: [], gpu: '{{header}}' };
const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: { vertex: '{{header}}\nvoid main() {}', fragment: '{{header}}\nvoid main() {}' },
};

// A user extension bit exercising both extraBits surfaces at once: a texture
// slot (resolved from the name-keyed `textures` option) and material struct
// fields (merged into the packed data class).
const testExtraBit: ShaderBit = {
  name: 'phongTestExtra',
  textures: ['extraMap'],
  bindings: {
    material: {
      extraParams: 'vec4<f32>',
    },
  },
  gpu: {
    fragment: {
      material: /*wgsl*/ `
  albedo += sampleExtraMap(input.vUV).rgb * material.extraParams.x;
`,
    },
  },
  gl: {
    fragment: {
      material: /*glsl*/ `
  albedo += sampleExtraMap(vUV).rgb * material.extraParams.x;
`,
    },
  },
};

const FEATURES: { name: string; options: PhongMaterialOptions }[] = [
  { name: 'specularTexture', options: { specularTexture: Texture.WHITE } },
  { name: 'emissive', options: { emissive: { color: 0xff0000 } } },
  // uvTransform's bit and two struct fields are unconditional; an explicit
  // construction matrix simply seeds them (and suspends frame derivation).
  { name: 'uvTransform', options: { uvTransform: new Matrix().scale(2, 2) } },
  { name: 'extraBits', options: { extraBits: [testExtraBit], textures: { extraMap: Texture.WHITE } } },
];

describe('PhongMaterial struct contract — construction layout == compiled layout', () => {
  const view = new View3D({ width: 64, height: 64 });

  it('holds across every feature combination, on both backends', () => {
    for (let mask = 0; mask < 1 << FEATURES.length; mask++) {
      const options: PhongMaterialOptions = {};
      let label = 'plain';
      for (let f = 0; f < FEATURES.length; f++) {
        if (!(mask & (1 << f))) continue;
        Object.assign(options, FEATURES[f].options);
        label += `+${FEATURES[f].name}`;
      }

      const material = new PhongMaterial(options);
      const descriptor = material.getPrimaryDescriptor(view);

      expect(materialStructSnapshot(mergeMaterialStruct(descriptor.bitsGpu)), label).toBe(
        material._materialStructSnapshot,
      );
      expect(() => validateMaterialStruct(descriptor.bitsGpu, material), label).not.toThrow();

      const gpu = compileWgslSource({
        bits: descriptor.bitsGpu,
        template: wgslTemplate,
        extraPlugins: [materialStructPackPlugin],
      });
      const gl = compileGlslSource({
        bits: descriptor.bitsGl,
        template: glslTemplate,
        extraPlugins: [materialStructPackPlugin],
        uboGroups: [],
        useLocations: false,
      });
      expect(materialStructSnapshot(gpu.structs.Material!), label).toBe(material._materialStructSnapshot);
      expect(materialStructSnapshot(gl.structs.Material as StructDefinition), label).toBe(
        material._materialStructSnapshot,
      );
    }
  });

  it('gates the maps it samples itself — no emissive/specular fields or slots until opted in', () => {
    const plain = new PhongMaterial({});
    expect(plain._materialStructSnapshot).toContain('"specularColor"');
    expect(plain._materialStructSnapshot).toContain('"shininess"');
    expect(plain._materialStructSnapshot).not.toContain('"emissive"');
    expect(plain._slotByName.specular).toBeUndefined();
    expect(plain._slotByName.emissive).toBeUndefined();
  });

  it('keeps the normal slot + normalScale resident (the pipe gates the sampling, so batching stays stable)', () => {
    // Matches Material3D: an unmapped material does no normal work either way,
    // so reserving keeps mapped/unmapped materials in one texture-count bucket.
    const plain = new PhongMaterial({});
    expect(plain._materialStructSnapshot).toContain('"normalScale"');
    expect(plain._slotByName.normal).toBeDefined();
    expect(plain.data.normalScale).toBe(1);

    const mapped = new PhongMaterial({ normalTexture: Texture.WHITE, normalScale: 0.5 });
    expect(mapped._materialStructSnapshot).toBe(plain._materialStructSnapshot);
    expect(mapped.data.normalScale).toBe(0.5);
  });

  it('alphaMode mask toggling rebuilds the bit list but never reshapes the struct', () => {
    const view2 = new View3D({ width: 64, height: 64 });
    const material = new PhongMaterial({ alphaMode: 'mask' });
    expect(() => validateMaterialStruct(material.getPrimaryDescriptor(view2).bitsGpu, material)).not.toThrow();
    material.alphaMode = 'opaque';
    expect(() => validateMaterialStruct(material.getPrimaryDescriptor(view2).bitsGpu, material)).not.toThrow();
  });
});

describe('PhongMaterial defaults + accessors', () => {
  it('defaults shininess 30, specularColor 0x111111, specularStrength 1', () => {
    const material = new PhongMaterial();
    expect(material.shininess).toBe(30);
    expect(material.specularColor).toBe(0x111111);
    expect(material.specularStrength).toBe(1);
    expect(new PhongMaterial({ specularStrength: 0.25 }).specularStrength).toBe(0.25);
  });

  it('round-trips runtime shininess / specularColor / specularStrength writes into packed data', () => {
    const material = new PhongMaterial();
    material.shininess = 96;
    expect(material.data.shininess).toBe(96);
    material.specularColor = 0xff8800;
    expect(material.specularColor).toBe(0xff8800);
    material.specularStrength = 0;
    expect(material.data.specularStrength).toBe(0);
    material.normalScale = 0.5;
    expect(material.data.normalScale).toBe(0.5);
  });

  // PhongMaterial owns its bit list, so the raw `descriptor` escape hatch is
  // omitted from its options — it would be silently ignored. The name-keyed
  // `textures` map IS accepted: it feeds extraBits' texture slots.
  it('rejects the descriptor escape hatch at compile time', () => {
    // @ts-expect-error — descriptor is omitted from PhongMaterialOptions
    const withDescriptor: PhongMaterialOptions = { descriptor: { bitsGpu: [], bitsGl: [] } };
    expect(withDescriptor).toBeDefined();
  });

  it('composes extraBits: struct fields land in data, texture slots resolve, and the bit precedes lighting', () => {
    const view2 = new View3D({ width: 64, height: 64 });
    const material = new PhongMaterial({
      extraBits: [testExtraBit],
      textures: { extraMap: Texture.WHITE },
    });

    // Struct contribution → generated data mirror; texture declaration → slot.
    expect((material.data as { extraParams?: Float32Array }).extraParams).toHaveLength(4);
    expect((material.textures as { extraMap?: Texture }).extraMap).toBe(Texture.WHITE);
    expect(material._slotByName.extraMap).toBeDefined();

    // Slotted after the built-in surface bits, before the lighting model —
    // material-slot code sees the post-baseColor albedo, end-slot code runs
    // before the view's tone-mapping bit (system bits append after these).
    const bits = material.getPrimaryDescriptor(view2).bitsGpu;
    const extraIndex = bits.findIndex((b) => b.name === 'phongTestExtra');
    const lightingIndex = bits.findIndex((b) => b.name === 'phongLighting');
    expect(extraIndex).toBeGreaterThan(bits.findIndex((b) => b.name === 'phongMaterial'));
    expect(lightingIndex).toBeGreaterThan(extraIndex);
  });

  it('exposes runtime emissive props only when constructed with the group', () => {
    expect(new PhongMaterial().emissive).toBeUndefined();

    const material = new PhongMaterial({ emissive: { color: 0xff2200, strength: 2 } });
    expect(material.emissive!.color).toBe(0xff2200);
    expect(material.emissive!.strength).toBe(2);

    material.emissive!.color = 0x00ff00;
    material.emissive!.strength = 3;
    expect(material.emissive!.color).toBe(0x00ff00);
    expect(material.data.emissiveStrength).toBe(3);
  });

  it('includes the phong lighting bit in the descriptor', () => {
    const view = new View3D({ width: 64, height: 64 });
    const bits = new PhongMaterial().getPrimaryDescriptor(view).bitsGpu;
    expect(bits.some((b) => b.name === 'phongLighting')).toBe(true);
  });

  it('caches one descriptor per environment kind, shared across views', () => {
    const material = new PhongMaterial();
    const viewA = new View3D({ width: 64, height: 64 });
    const viewB = new View3D({ width: 64, height: 64 });

    const defaultDescriptor = material.getPrimaryDescriptor(viewA);
    expect(defaultDescriptor.bitsGpu.some((b) => b.name === 'envSourceDefault')).toBe(true);
    expect(material.getPrimaryDescriptor(viewB)).toBe(defaultDescriptor);

    viewB.environment = { skyColor: 0x88ccff, groundColor: 0x553311 };
    const hemisphereDescriptor = material.getPrimaryDescriptor(viewB);
    expect(hemisphereDescriptor).not.toBe(defaultDescriptor);
    expect(hemisphereDescriptor.bitsGpu.some((b) => b.name === 'envSourceHemisphere')).toBe(true);

    // Repeat lookups hit the cache; the default-env view keeps its descriptor.
    expect(material.getPrimaryDescriptor(viewB)).toBe(hemisphereDescriptor);
    expect(material.getPrimaryDescriptor(viewA)).toBe(defaultDescriptor);
  });
});
