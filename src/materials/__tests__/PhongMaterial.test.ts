import { Matrix, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { materialStructSnapshot } from '~/core/shader/codegen/materialStruct';
import { materialStructPackPlugin } from '~/core/shader/codegen/materialStructPackPlugin';
import type { ShaderBit, StructDefinition } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import type { PhongMaterialOptions } from '~/materials/phong/PhongMaterial';
import { getMaterialLayout, validateMaterialStruct } from '~/materials/utils/validateMaterialTextureSlots';
import { View3D } from '~/scene/View3D';

const wgslTemplate: ShaderBitTemplate = { bindGroups: [], gpu: '{{header}}' };
const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: { vertex: '{{header}}\nvoid main() {}', fragment: '{{header}}\nvoid main() {}' },
};

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

      const layout = getMaterialLayout(descriptor.bitsGpu);
      expect(layout.structSnapshot, label).toBe(material._materialStructSnapshot);
      expect(() => validateMaterialStruct(layout, material), label).not.toThrow();

      const gpu = compileWgslSource({
        bits: descriptor.bitsGpu,
        template: wgslTemplate,
        extraPlugins: [materialStructPackPlugin],
      });
      const gl = compileGlslSource({
        bits: descriptor.bitsGl,
        template: glslTemplate,
        extraPlugins: [materialStructPackPlugin],
        useLocations: false,
      });
      expect(materialStructSnapshot(gpu.structs.Material), label).toBe(material._materialStructSnapshot);
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

  it('reserves the normal slot and normalScale even when unmapped, so a map never changes the texture count', () => {
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
    expect(() =>
      validateMaterialStruct(getMaterialLayout(material.getPrimaryDescriptor(view2).bitsGpu), material),
    ).not.toThrow();
    material.alphaMode = 'opaque';
    expect(() =>
      validateMaterialStruct(getMaterialLayout(material.getPrimaryDescriptor(view2).bitsGpu), material),
    ).not.toThrow();
  });
});

describe('PhongMaterial defaults + accessors', () => {
  it('composes extraBits: struct fields land in data, texture slots resolve, and the bit sits before lighting', () => {
    const view2 = new View3D({ width: 64, height: 64 });
    const material = new PhongMaterial({
      extraBits: [testExtraBit],
      textures: { extraMap: Texture.WHITE },
    });

    expect((material.data as { extraParams?: Float32Array }).extraParams).toHaveLength(4);
    expect((material.textures as { extraMap?: Texture }).extraMap).toBe(Texture.WHITE);
    expect(material._slotByName.extraMap).toBeDefined();

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

    expect(material.getPrimaryDescriptor(viewB)).toBe(hemisphereDescriptor);
    expect(material.getPrimaryDescriptor(viewA)).toBe(defaultDescriptor);
  });
});
