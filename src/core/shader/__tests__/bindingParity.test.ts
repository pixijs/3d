import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { texturesPluginGl } from '~/core/gl/shader/texturesPluginGl';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { materialStoragePaddingPlugin } from '~/core/gpu/codegen/materialStoragePaddingPlugin';
import { buildWgslBindingMap, collectBindings, emitBindingsWgsl } from '~/core/gpu/codegen/wgslBindingsPlugin';
import { texturesPluginGpu } from '~/core/gpu/shader/texturesPluginGpu';
import { generateGroupMap } from '~/core/shader/codegen/generateGroupMap';
import { materialStructPackPlugin } from '~/core/shader/codegen/materialStructPackPlugin';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Material3DOptions } from '~/materials/pbr/Material3D';
import { collectTextureNames } from '~/materials/utils/validateMaterialTextureSlots';
import { View3D } from '~/scene/View3D';

/**
 * WebGL and WebGPU assign binding indices in two independent code paths —
 * `generateGroupMap` (GL) and `buildWgslBindingMap` (WGSL, which the emitter
 * consumes directly). Nothing structural forces them to agree, so this suite
 * is the referee: identical bit lists must produce identical per-group
 * binding-name order, identical Material struct layouts, and identical
 * texture sequences on both backends.
 *
 * Scope note: the *full* per-backend pipelines intentionally diverge in the
 * global group (GL feeds per-instance data through attributes where WebGPU
 * uses storage buffers), so parity is asserted where it must hold — shared
 * bit lists and the material layer — not on backend infrastructure bits.
 */

// --- Binding-assignment lockstep (synthetic bits, both groups + all kinds) ---

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
      },
    },
  },
  {
    name: 'parityBatch',
    bindings: {
      batch: { uParityTexture: 'texture_2d<f32>' },
      global: {
        // Deduped against parityGlobals' declaration — must not double-assign.
        uParityView: 'mat4x4<f32>',
        uParityExposure: 'f32',
      },
    },
  },
];

/** Flatten a group's entries to binding-ordered names, per backend. */
function glGroupNames(map: Record<number, Record<number, string>>, groupIndex: number): string[] {
  const group = map[groupIndex] ?? {};
  return Object.keys(group)
    .map(Number)
    .sort((a, b) => a - b)
    .map((binding) => group[binding]);
}

describe('GL ↔ WGSL binding assignment lockstep', () => {
  it('assigns identical per-group binding-name order for the same bits', () => {
    const wgsl = buildWgslBindingMap(collectBindings(parityBits, parityTemplate));
    const gl = generateGroupMap(parityBits, parityTemplate);

    for (const [groupName, { groupIndex, entries }] of Object.entries(wgsl)) {
      const wgslNames = entries.map((e) => e.name);
      expect(glGroupNames(gl, groupIndex), `group '${groupName}'`).toEqual(wgslNames);
    }
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
});

// --- Material-layer parity across the full feature matrix (real materials) ---

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

  it('produces identical Material structs and texture sequences on both backends', () => {
    for (let mask = 0; mask < 1 << FEATURES.length; mask++) {
      const options: Material3DOptions = {};
      let label = 'plain';
      for (let f = 0; f < FEATURES.length; f++) {
        if (!(mask & (1 << f))) continue;
        Object.assign(options, FEATURES[f].options);
        label += `+${FEATURES[f].name}`;
      }

      const descriptor = new Material3D(options).getPrimaryDescriptor(view);

      // Texture sequence — the shader's sample indices — must match.
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
        uboGroups: [],
        useLocations: false,
      });

      // Field ORDER and types must match exactly — the JIT material sync and
      // the GL texel accessors derive offsets from this shape.
      expect(Object.entries(gl.structs.Material ?? {}), label).toEqual(Object.entries(gpu.structs.Material ?? {}));
    }
  });

  it('GPU stride padding only appends a trailing _pad field', () => {
    const descriptor = new Material3D({
      emissive: { color: 0xff0000 },
      specular: { factor: 0.5 },
      iridescence: { factor: 0.5 },
      transmission: { factor: 0.5 },
      clearcoat: {},
      sheen: { color: 0xffffff },
    }).getPrimaryDescriptor(view);

    const unpadded = compileWgslSource({
      bits: descriptor.bitsGpu,
      template: wgslTemplate,
      extraPlugins: [materialStructPackPlugin, texturesPluginGpu],
    });
    const padded = compileWgslSource({
      bits: descriptor.bitsGpu,
      template: wgslTemplate,
      extraPlugins: [materialStructPackPlugin, materialStoragePaddingPlugin, texturesPluginGpu],
    });

    const unpaddedFields = Object.keys(unpadded.structs.Material!);
    const paddedFields = Object.keys(padded.structs.Material!);

    expect(paddedFields.slice(0, unpaddedFields.length)).toEqual(unpaddedFields);
    expect(paddedFields.slice(unpaddedFields.length).every((f) => f === '_pad')).toBe(true);
  });
});
