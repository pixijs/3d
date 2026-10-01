import { describe, expect, it } from 'vitest';

import { MATERIAL_STRIDE_FLOATS } from '~/core/buffers/MaterialDataStoreBuffer';
import { createStructLayout } from '~/core/shader/codegen/structLayout';
import type { StructDefinition } from '~/core/shader/ShaderBit';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { getOrCreateMaterialDataClass } from '~/materials/utils/createMaterialDataClass';

const DEF: StructDefinition = {
  wide: 'vec4<f32>',
  tint: 'vec3<f32>',
  strength: 'f32',
  flags: 'u32',
};

/** Stands in for the owning material, whose `update()` is all the data class calls */
const STUB_MATERIAL = { update(): void {} } as unknown as BaseMaterial3D;

function makeData() {
  return new (getOrCreateMaterialDataClass(DEF, JSON.stringify(DEF)))(STUB_MATERIAL);
}

describe('getOrCreateMaterialDataClass', () => {
  it('lays accessors out at the struct offsets, over one stride-sized buffer', () => {
    const data = makeData();
    const layout = createStructLayout(DEF);
    const offsets = Object.fromEntries(layout.elements.map((e) => [e.name, e.offset / 4]));

    expect(data._f32.length).toBe(MATERIAL_STRIDE_FLOATS);

    data.wide = [1, 2, 3, 4];
    data.tint = [5, 6, 7];
    data.strength = 8;
    data.flags = 0xffff0001;

    expect([...data._f32.subarray(offsets.wide, offsets.wide + 4)]).toEqual([1, 2, 3, 4]);
    expect([...data._f32.subarray(offsets.tint, offsets.tint + 3)]).toEqual([5, 6, 7]);
    expect(data._f32[offsets.strength]).toBe(8);
    expect(data.flags).toBe(0xffff0001);
  });

  it('signals the owning material on every write except a scalar write of the current value', () => {
    let updates = 0;
    const counting = { update: () => void updates++ } as unknown as BaseMaterial3D;
    const data = new (getOrCreateMaterialDataClass(DEF, JSON.stringify(DEF)))(counting);

    data.strength = 0;
    expect(updates).toBe(0);

    data.strength = 2;
    expect(updates).toBe(1);

    data.tint = [0, 0, 0];
    expect(updates).toBe(2);
  });

  it('returns cached live vector views that skip the upload signal, and throws on an oversized vector write', () => {
    let updates = 0;
    const counting = { update: () => void updates++ } as unknown as BaseMaterial3D;
    const data = new (getOrCreateMaterialDataClass(DEF, JSON.stringify(DEF)))(counting);

    const tint = data.tint as Float32Array;
    expect(tint).toBeInstanceOf(Float32Array);
    expect(data.tint).toBe(tint);

    tint[0] = 9;
    expect((data.tint as Float32Array)[0]).toBe(9);
    expect(updates).toBe(0);

    expect(() => (data.wide = [1, 2, 3, 4, 5])).toThrow(RangeError);
  });

  it('makes a stray boolean flag write a compile error, and inert at runtime', () => {
    const data = makeData();

    // @ts-expect-error MaterialData has no boolean members, so `_dirty = true` can't pass for a signal
    data._dirty = true;

    expect(data.strength).toBe(0);
  });
});

describe('material.data on real materials', () => {
  it('mirrors the construction struct, with feature fields only when opted in and one class per feature set', () => {
    const clearcoated = new Material3D({ clearcoat: {} });
    expect(clearcoated.data.clearcoatParams).toBeInstanceOf(Float32Array);
    expect((clearcoated.data.clearcoatParams as Float32Array).length).toBe(4);
    expect(clearcoated.data.baseColor).toBeInstanceOf(Float32Array);
    expect(typeof clearcoated.data.normalScale).toBe('number');

    const plain = new Material3D({});
    expect(plain.data.clearcoatParams).toBeUndefined();

    expect(Object.getPrototypeOf(new Material3D({}).data)).toBe(Object.getPrototypeOf(plain.data));
  });
});
