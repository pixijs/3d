import { describe, expect, it } from 'vitest';

import { materialStructSnapshot, mergeMaterialStruct } from '~/core/shader/codegen/materialStruct';
import type { ShaderBit, StructDefinition } from '~/core/shader/ShaderBit';

const materialBit = (name: string, material: StructDefinition): ShaderBit => ({
  name,
  bindings: { material },
});

describe('mergeMaterialStruct lays out the struct the shader and the material data class share', () => {
  it('orders fields by alignment tier, so the layout and its snapshot ignore which bit declares first', () => {
    const forward = mergeMaterialStruct([
      materialBit('scalar', { cutoff: 'f32' }),
      materialBit('wide', { color: 'vec4<f32>' }),
    ]);
    const reverse = mergeMaterialStruct([
      materialBit('wide', { color: 'vec4<f32>' }),
      materialBit('scalar', { cutoff: 'f32' }),
    ]);

    expect(Object.keys(forward)).toEqual(['color', 'cutoff']);
    expect(materialStructSnapshot(forward)).toBe(materialStructSnapshot(reverse));
  });

  it('keeps the first type when a later bit redeclares a field with a different type', () => {
    const merged = mergeMaterialStruct([materialBit('a', { value: 'vec4<f32>' }), materialBit('b', { value: 'f32' })]);

    expect(merged.value).toBe('vec4<f32>');
  });
});

describe('materialStructSnapshot, which keys the material data classes, gives each layout its own key', () => {
  it('gives distinct snapshots to an empty struct and to one field with a new type, a new name or a neighbour', () => {
    const layouts = [
      mergeMaterialStruct([]),
      mergeMaterialStruct([materialBit('a', { baseColor: 'vec4<f32>' })]),
      mergeMaterialStruct([materialBit('a', { baseColor: 'vec3<f32>' })]),
      mergeMaterialStruct([materialBit('a', { baseColor: 'vec4<f32>', alphaCutoff: 'f32' })]),
      mergeMaterialStruct([materialBit('a', { albedo: 'vec4<f32>' })]),
    ];

    const snapshots = layouts.map(materialStructSnapshot);

    expect(new Set(snapshots).size).toBe(layouts.length);
  });
});
