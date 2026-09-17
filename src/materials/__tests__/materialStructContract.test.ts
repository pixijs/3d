import { Matrix } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { materialStructSnapshot, mergeMaterialStruct } from '~/core/shader/codegen/materialStruct';
import { materialStructPackPlugin } from '~/core/shader/codegen/materialStructPackPlugin';
import type { ShaderBit, StructDefinition } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Material3DOptions } from '~/materials/pbr/Material3D';
import { validateMaterialStruct } from '~/materials/utils/validateMaterialTextureSlots';
import { View3D } from '~/scene/View3D';

const wgslTemplate: ShaderBitTemplate = { bindGroups: [], gpu: '{{header}}' };
const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: { vertex: '{{header}}\nvoid main() {}', fragment: '{{header}}\nvoid main() {}' },
};

const FEATURES: { name: string; options: Material3DOptions }[] = [
  { name: 'emissive', options: { emissive: { color: 0xff0000 } } },
  { name: 'specular', options: { specular: { factor: 0.5 } } },
  { name: 'iridescence', options: { iridescence: { factor: 0.5 } } },
  { name: 'transmission', options: { transmission: { factor: 0.5 } } },
  { name: 'clearcoat', options: { clearcoat: {} } },
  { name: 'sheen', options: { sheen: { color: 0xffffff } } },
  // uvTransform's bit and two struct fields are unconditional; an explicit
  // construction matrix simply seeds them (and suspends frame derivation).
  { name: 'uvTransform', options: { uvTransform: new Matrix().scale(2, 2) } },
];

describe('Material struct contract — construction layout == compiled layout', () => {
  const view = new View3D({ width: 64, height: 64 });

  it('holds across every feature combination, on both backends', () => {
    for (let mask = 0; mask < 1 << FEATURES.length; mask++) {
      const options: Material3DOptions = {};
      let label = 'plain';
      for (let f = 0; f < FEATURES.length; f++) {
        if (!(mask & (1 << f))) continue;
        Object.assign(options, FEATURES[f].options);
        label += `+${FEATURES[f].name}`;
      }

      const material = new Material3D(options);
      const descriptor = material.getPrimaryDescriptor(view);

      // The descriptor's bit list must reproduce the construction snapshot…
      expect(materialStructSnapshot(mergeMaterialStruct(descriptor.bitsGpu)), label).toBe(
        material._materialStructSnapshot,
      );
      expect(() => validateMaterialStruct(descriptor.bitsGpu, material), label).not.toThrow();

      // …and so must the structs both real compilers canonicalise.
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

  it('keeps normalScale in every material struct (per-mesh normal-mapping bits must not reshape it)', () => {
    const plain = new Material3D({ roughness: 0.5 });
    expect(plain._materialStructSnapshot).toContain('"normalScale"');
  });

  it('rejects struct-bearing bits that bypass construction', () => {
    const view2 = makeViewLocal();
    const material = new Material3D({});
    const bits = [...material.getPrimaryDescriptor(view2).bitsGpu];
    const intruder: ShaderBit = { name: 'structIntruder', bindings: { material: { sneakyField: 'f32' } } };

    expect(() => validateMaterialStruct([...bits, intruder], material)).toThrow(/construction-time/);
  });

  it('covers FlatMaterial and raw-descriptor materials too', () => {
    const view2 = makeViewLocal();

    const flat = new FlatMaterial({ uvTransform: new Matrix(), alphaMode: 'mask' });
    const flatDescriptor = flat.getPrimaryDescriptor(view2);
    expect(() => validateMaterialStruct(flatDescriptor.bitsGpu, flat)).not.toThrow();

    // alphaMode toggling rebuilds the bit list but must not reshape the
    // struct (alphaCutoff is declared by flatMaterialBit unconditionally).
    flat.alphaMode = 'opaque';
    expect(() => validateMaterialStruct(flat.getPrimaryDescriptor(view2).bitsGpu, flat)).not.toThrow();
  });
});

describe('uvTransform (unconditional)', () => {
  const view = new View3D({ width: 64, height: 64 });

  it('runtime writes are data syncs, never a variant rebuild', () => {
    const material = new Material3D({ uvTransform: new Matrix().translate(0.5, 0) });
    const before = material.getPrimaryDescriptor(view);
    expect(before.bitsGpu.some((b) => b.name === 'uvTransform')).toBe(true);
    expect(material.data.uvOffset![0]).toBe(0.5);

    material.uvTransform = new Matrix().translate(0.25, 0);
    expect(material.data.uvOffset![0]).toBe(0.25);
    expect(material.getPrimaryDescriptor(view)).toBe(before);

    // Clearing resets to identity (no framed baseColor to re-derive from);
    // the descriptor is untouched — the bit is unconditional.
    material.uvTransform = undefined;
    expect(material.uvTransform).toBeUndefined();
    expect(material.data.uvTransformRow0![0]).toBe(1);
    expect(material.data.uvOffset![0]).toBe(0);
    expect(material.getPrimaryDescriptor(view)).toBe(before);
  });

  it('carries the bit and live fields on every material, opted-in or not', () => {
    const material = new Material3D({});
    expect(material.getPrimaryDescriptor(view).bitsGpu.some((b) => b.name === 'uvTransform')).toBe(true);

    // Writes work without any construction opt-in.
    material.uvTransform = new Matrix().scale(3, 3);
    expect(material.data.uvTransformRow0![0]).toBe(3);
    expect(material.uvTransform).toBeDefined();
  });
});

describe('mergeMaterialStruct', () => {
  it('merges first-wins, skips resource/storage declarations, and packs', () => {
    const a: ShaderBit = {
      name: 'mergeA',
      bindings: { material: { scalarOne: 'f32', wide: 'vec4<f32>', deadTexture: 'texture_2d<f32>' } },
    };
    const b: ShaderBit = {
      name: 'mergeB',
      bindings: { material: { scalarTwo: 'f32', wide: 'vec4<f32>' } },
    };

    const merged = mergeMaterialStruct([a, b]);

    expect(merged.deadTexture).toBeUndefined();
    // Packed: the vec4 leads, scalars follow.
    expect(Object.keys(merged)).toEqual(['wide', 'scalarOne', 'scalarTwo']);
  });
});

function makeViewLocal(): View3D {
  return new View3D({ width: 64, height: 64 });
}
