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

// Setters route through the owning material's update(); a stub carrying the
// one method the accessors touch keeps the data class testable standalone.
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

  it('signals the owning material per write, skipping no-op scalar writes', () => {
    let updates = 0;
    const counting = { update: () => void updates++ } as unknown as BaseMaterial3D;
    const data = new (getOrCreateMaterialDataClass(DEF, JSON.stringify(DEF)))(counting);

    data.strength = 0; // already 0 — no-op, no signal
    expect(updates).toBe(0);

    data.strength = 2;
    expect(updates).toBe(1);

    data.tint = [0, 0, 0]; // vector writes always signal (copy, no compare)
    expect(updates).toBe(2);
  });

  it('returns live vector views; oversized writes throw instead of corrupting neighbours', () => {
    let updates = 0;
    const counting = { update: () => void updates++ } as unknown as BaseMaterial3D;
    const data = new (getOrCreateMaterialDataClass(DEF, JSON.stringify(DEF)))(counting);

    const tint = data.tint as Float32Array;
    expect(tint).toBeInstanceOf(Float32Array);
    expect(data.tint).toBe(tint); // cached view

    // Live view: in-place mutation hits the packed buffer but, documented,
    // bypasses the upload signal — callers pair it with material.update().
    tint[0] = 9;
    expect((data.tint as Float32Array)[0]).toBe(9);
    expect(updates).toBe(0);

    expect(() => (data.wide = [1, 2, 3, 4, 5])).toThrow(RangeError);
  });

  it('caches one class per snapshot', () => {
    const a = getOrCreateMaterialDataClass(DEF, JSON.stringify(DEF));
    const b = getOrCreateMaterialDataClass(DEF, JSON.stringify(DEF));
    const other = getOrCreateMaterialDataClass({ solo: 'f32' }, 'solo');

    expect(a).toBe(b);
    expect(other).not.toBe(a);
    expect(new a(STUB_MATERIAL)).not.toBeInstanceOf(other);
  });

  it('makes stray boolean flag writes a compile error', () => {
    const data = makeData();

    // @ts-expect-error — MaterialData has no boolean members: the old
    // `_dirty = true` idiom must not typecheck into a silent no-op.
    data._dirty = true;

    expect(data.strength).toBe(0); // untouched — the write created an inert property only
  });

  it('throws at class build when the layout exceeds the store stride', () => {
    const oversized: StructDefinition = {};
    for (let i = 0; i < MATERIAL_STRIDE_FLOATS / 4 + 1; i++) oversized[`v${i}`] = 'vec4<f32>';

    expect(() => getOrCreateMaterialDataClass(oversized, 'oversized')).toThrow(/overflow into adjacent/);
  });
});

describe('material.data on real materials', () => {
  it('mirrors the construction struct — feature fields appear only when opted in', () => {
    const clearcoated = new Material3D({ clearcoat: {} });
    expect(clearcoated.data.clearcoatParams).toBeInstanceOf(Float32Array);
    expect((clearcoated.data.clearcoatParams as Float32Array).length).toBe(4);
    expect(clearcoated.data.baseColor).toBeInstanceOf(Float32Array);
    expect(typeof clearcoated.data.normalScale).toBe('number');

    const plain = new Material3D({});
    expect(plain.data.clearcoatParams).toBeUndefined();
    expect('_pad' in plain.data).toBe(false);

    // Same feature set → same generated class (shared hidden class).
    expect(Object.getPrototypeOf(new Material3D({}).data)).toBe(Object.getPrototypeOf(plain.data));
  });
});
