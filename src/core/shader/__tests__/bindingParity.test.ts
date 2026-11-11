import { captureWarnings } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { createTexturesPluginGl } from '~/core/gl/shader/texturesPluginGl';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { buildWgslBindingMap, collectBindings, emitBindingsWgsl } from '~/core/gpu/codegen/wgslBindingsPlugin';
import { createTexturesPluginGpu } from '~/core/gpu/shader/texturesPluginGpu';
import { generateGroupMap } from '~/core/shader/codegen/generateGroupMap';
import { materialStructPackPlugin } from '~/core/shader/codegen/materialStructPackPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Material3DOptions } from '~/materials/pbr/Material3D';
import { collectTextureNames } from '~/materials/utils/validateMaterialTextureSlots';
import { View3D } from '~/scene/View3D';

const texturesPluginGpu = createTexturesPluginGpu('direct');
const texturesPluginGl = createTexturesPluginGl('direct');

const parityTemplate: ShaderBitTemplate = {
  bindGroups: ['global', 'batch'],
  gpu: '{{header}}',
  gl: { vertex: '{{header}}\nvoid main() {}', fragment: '{{header}}\nvoid main() {}' },
};

const parityBits: ShaderBit[] = [
  {
    name: 'parityGlobals',
    structs: { ParityLight: { position: 'vec3<f32>', range: 'f32' } },
    bindings: {
      global: {
        uParityView: 'mat4x4<f32>',
        uParityEnv: 'texture_cube<f32>',
        uParitySampler: 'sampler',
        uParityLights: 'storage<ParityLight>',
        uParityKey: 'uniform<ParityLight>',
      },
    },
  },
  {
    name: 'parityBatch',
    bindings: {
      batch: { uParityTexture: 'texture_2d<f32>' },
      global: {
        uParityView: 'mat4x4<f32>',
        uParityExposure: { type: 'f32', visibility: 'fragment' },
        parityDraw: {
          uParityModel: 'mat4x4<f32>',
          uParityTint: { type: 'vec4<f32>', visibility: 'vertex' },
        },
      },
    },
  },
];

function glGroupNames(map: Record<number, Record<number, string>>, groupIndex: number): string[] {
  const group = map[groupIndex] ?? {};
  return Object.keys(group)
    .map(Number)
    .sort((a, b) => a - b)
    .map((binding) => group[binding]);
}

describe('generateGroupMap (GL) and buildWgslBindingMap (WGSL), two separate paths, assign the same bindings', () => {
  it('assigns identical per-group binding-name order for the same bits', () => {
    const wgsl = buildWgslBindingMap(collectBindings(parityBits, parityTemplate));
    const gl = generateGroupMap(parityBits, parityTemplate);

    for (const [groupName, { groupIndex, entries }] of Object.entries(wgsl)) {
      const wgslNames = entries.map((e) => e.name);
      expect(glGroupNames(gl, groupIndex), `group '${groupName}'`).toEqual(wgslNames);
    }
  });

  it('gives a uniform buffer one binding after the storage buffers, and a uniform group declared inside a bind group one after that, with its own WGSL struct', () => {
    const collected = collectBindings(parityBits, parityTemplate);
    const names = buildWgslBindingMap(collected).global.entries.map((e) => e.name);
    const source = emitBindingsWgsl(collected);

    expect(names).toEqual(['global', 'uParityEnv', 'uParitySampler', 'uParityLights', 'uParityKey', 'parityDraw']);
    expect(source).toContain('@group(0) @binding(4) var<uniform> uParityKey: ParityLight;');
    expect(source).toContain('struct ParityDraw {\n  uParityModel: mat4x4<f32>,\n  uParityTint: vec4<f32>,\n}');
    expect(source).toContain('@group(0) @binding(5) var<uniform> parityDraw: ParityDraw;');
    expect(collected.structs.Global).toEqual({ uParityView: 'mat4x4<f32>', uParityExposure: 'f32' });
  });

  it('skips a group the template does not bind, without warning', () => {
    const bits: ShaderBit[] = [
      ...parityBits,
      {
        name: 'parityMaterial',
        bindings: { material: { baseColor: 'vec4<f32>', uBaseColorTexture: 'texture_2d<f32>' } },
      },
    ];

    const warnings = captureWarnings(() => {
      expect(generateGroupMap(bits, parityTemplate)).toEqual(generateGroupMap(parityBits, parityTemplate));
    });
    expect(warnings).toEqual([]);
  });

  it('emits WGSL @group/@binding lines exactly matching the map', () => {
    const collected = collectBindings(parityBits, parityTemplate);
    const source = emitBindingsWgsl(collected);
    const map = buildWgslBindingMap(collected);

    const emitted = [...source.matchAll(/@group\((\d+)\) @binding\((\d+)\) var(?:<[^>]+>)? (\w+):/g)].map((m) => ({
      group: Number(m[1]),
      binding: Number(m[2]),
      name: m[3],
    }));
    const expected = Object.values(map).flatMap(({ groupIndex, entries }) =>
      entries.map((e) => ({ group: groupIndex, binding: e.binding, name: e.name })),
    );

    expect(emitted).toEqual(expected);
  });

  it('declares an integer texture with its own sampler type on both backends', () => {
    const bits: ShaderBit[] = [
      {
        name: 'parityIntegers',
        bindings: { global: { uParityStore: 'texture_2d<u32>', uParitySigned: 'texture_2d<i32>' } },
      },
    ];
    const gl = compileGlslSource({ bits, template: parityTemplate, useLocations: false });
    const gpu = compileWgslSource({ bits, template: parityTemplate });

    expect(gl.fragment).toContain('uniform usampler2D uParityStore;');
    expect(gl.fragment).toContain('uniform isampler2D uParitySigned;');
    expect(gpu.fragment.source).toContain('var uParityStore: texture_2d<u32>;');
    expect(gpu.fragment.source).toContain('var uParitySigned: texture_2d<i32>;');

    const sampleTypes = gpu.gpuLayout[0].map((entry) => entry.texture?.sampleType);
    expect(sampleTypes).toEqual(['uint', 'sint']);
  });
});

const FEATURES: { name: string; options: Material3DOptions }[] = [
  { name: 'emissive', options: { emissive: { color: 0xff0000 } } },
  { name: 'specular', options: { specular: { factor: 0.5 } } },
  { name: 'iridescence', options: { iridescence: { factor: 0.5 } } },
  { name: 'transmission', options: { transmission: { factor: 0.5 } } },
  { name: 'clearcoat', options: { clearcoat: {} } },
  { name: 'sheen', options: { sheen: { color: 0xffffff } } },
];

const wgslTemplate: ShaderBitTemplate = { bindGroups: [], gpu: '{{header}}\n{{textureGetters}}' };
const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\n{{textureGetters}}\nvoid main() {}',
  },
};

describe('material-layer parity across the feature matrix', () => {
  const view = new View3D({ width: 64, height: 64 });

  it('produces identical texture sequences and Material structs, field order included, on both backends', () => {
    for (let mask = 0; mask < 1 << FEATURES.length; mask++) {
      const options: Material3DOptions = {};
      let label = 'plain';
      for (let f = 0; f < FEATURES.length; f++) {
        if (!(mask & (1 << f))) continue;
        Object.assign(options, FEATURES[f].options);
        label += `+${FEATURES[f].name}`;
      }

      const descriptor = new Material3D(options).getPrimaryDescriptor(view);

      expect(collectTextureNames(descriptor.bitsGl), label).toEqual(collectTextureNames(descriptor.bitsGpu));

      const gpu = compileWgslSource({
        bits: descriptor.bitsGpu,
        template: wgslTemplate,
        extraPlugins: [materialStructPackPlugin, texturesPluginGpu],
      });
      const gl = compileGlslSource({
        bits: descriptor.bitsGl,
        template: glslTemplate,
        extraPlugins: [materialStructPackPlugin, texturesPluginGl],
        useLocations: false,
      });

      expect(Object.entries(gl.structs.Material ?? {}), label).toEqual(Object.entries(gpu.structs.Material ?? {}));
    }
  });
});
