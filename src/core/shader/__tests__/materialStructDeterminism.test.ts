import { describe, expect, it } from 'vitest';

import { materialStructSnapshot, mergeMaterialStruct } from '~/core/shader/codegen/materialStruct';
import { packStructFields } from '~/core/shader/codegen/packStructFields';
import { createStructLayout } from '~/core/shader/codegen/structLayout';
import type { ShaderBit, StructDefinition } from '~/core/shader/ShaderBit';

// The Material struct layout is the single source of truth shared by the
// compiled shader and the CPU-side data class; `materialStructSnapshot` keys
// the generated-class and shader-variant caches off it. These tests pin the
// invariants that keep the two sides in lockstep: a layout is a deterministic
// function of its bit list, and distinct layouts never collide onto one
// snapshot. A regression here corrupts material data silently, so it is worth
// asserting directly rather than trusting it by construction.

const materialBit = (name: string, material: StructDefinition): ShaderBit => ({
  name,
  bindings: { material },
});

describe('mergeMaterialStruct — deterministic layout', () => {
  it('is a pure function of the bit list: identical inputs yield identical output', () => {
    const bits = [
      materialBit('base', { baseColor: 'vec4<f32>' }),
      materialBit('pbr', { metallic: 'f32', roughness: 'f32' }),
    ];

    const a = mergeMaterialStruct(bits);
    const b = mergeMaterialStruct(bits);

    expect(a).toEqual(b);
    expect(materialStructSnapshot(a)).toBe(materialStructSnapshot(b));
  });

  it('orders fields by alignment tier independent of which bit declares them first', () => {
    const forward = mergeMaterialStruct([
      materialBit('scalar', { cutoff: 'f32' }),
      materialBit('wide', { color: 'vec4<f32>' }),
    ]);
    const reverse = mergeMaterialStruct([
      materialBit('wide', { color: 'vec4<f32>' }),
      materialBit('scalar', { cutoff: 'f32' }),
    ]);

    // The vec4 sorts ahead of the scalar regardless of declaration order, so
    // the packed layout — and its snapshot — is bit-order-independent across
    // alignment tiers.
    expect(Object.keys(forward)).toEqual(['color', 'cutoff']);
    expect(materialStructSnapshot(forward)).toBe(materialStructSnapshot(reverse));
  });

  it('preserves declaration order within a single alignment tier', () => {
    // Same-tier fields keep bit-declaration order (packStructFields tiebreaks
    // on declaration index, by design), so two materials with the same scalar
    // set declared in different orders produce different layouts. That is a
    // deliberate trade — asserted here so a future switch to canonical (name)
    // ordering, which would dedupe such variants, is a conscious decision and
    // not a silent change.
    expect(
      Object.keys(mergeMaterialStruct([materialBit('a', { alpha: 'f32' }), materialBit('b', { beta: 'f32' })])),
    ).toEqual(['alpha', 'beta']);

    expect(
      Object.keys(mergeMaterialStruct([materialBit('b', { beta: 'f32' }), materialBit('a', { alpha: 'f32' })])),
    ).toEqual(['beta', 'alpha']);
  });

  it('dedupes a field declared by multiple bits (first declaration wins)', () => {
    const merged = mergeMaterialStruct([
      materialBit('a', { baseColor: 'vec4<f32>' }),
      materialBit('b', { baseColor: 'vec4<f32>' }),
    ]);

    expect(Object.keys(merged)).toEqual(['baseColor']);
  });

  it('keeps the first type when a later bit redeclares a field with a different type', () => {
    const merged = mergeMaterialStruct([materialBit('a', { value: 'vec4<f32>' }), materialBit('b', { value: 'f32' })]);

    expect(merged.value).toBe('vec4<f32>');
  });

  it('ignores texture bindings in the material group (only data fields are packed)', () => {
    const merged = mergeMaterialStruct([
      { name: 'textured', bindings: { material: { baseColor: 'vec4<f32>', map: 'texture_2d<f32>' } } },
    ]);

    expect(Object.keys(merged)).toEqual(['baseColor']);
  });
});

describe('materialStructSnapshot — collision freedom', () => {
  it('distinct layouts produce distinct snapshots', () => {
    const layouts = [
      mergeMaterialStruct([]), // empty
      mergeMaterialStruct([materialBit('a', { baseColor: 'vec4<f32>' })]), // one field
      mergeMaterialStruct([materialBit('a', { baseColor: 'vec3<f32>' })]), // same name, different type
      mergeMaterialStruct([materialBit('a', { baseColor: 'vec4<f32>', alphaCutoff: 'f32' })]), // extra field
      mergeMaterialStruct([materialBit('a', { albedo: 'vec4<f32>' })]), // different name
    ];

    const snapshots = layouts.map(materialStructSnapshot);

    expect(new Set(snapshots).size).toBe(layouts.length);
  });

  it('snapshot is stable and structurally round-trips to the layout', () => {
    const layout = mergeMaterialStruct([materialBit('a', { baseColor: 'vec4<f32>', alphaCutoff: 'f32' })]);
    const snapshot = materialStructSnapshot(layout);

    expect(materialStructSnapshot(layout)).toBe(snapshot);
    expect(JSON.parse(snapshot)).toEqual(layout);
  });
});

describe('packStructFields — tight, deterministic packing', () => {
  it('is deterministic for a given definition', () => {
    const def: StructDefinition = { s: 'f32', v: 'vec4<f32>', n: 'vec3<f32>', t: 'f32' };

    expect(packStructFields(def)).toEqual(packStructFields(def));
  });

  it('sorts wide types ahead of scalars', () => {
    expect(Object.keys(packStructFields({ s: 'f32', v: 'vec4<f32>' }))).toEqual(['v', 's']);
  });

  it('pulls a scalar into a vec3 tail to fill the 16-byte block', () => {
    const packed = packStructFields({ pad: 'f32', normal: 'vec3<f32>' });

    expect(Object.keys(packed)).toEqual(['normal', 'pad']);
    // vec3 (12B) + the pulled scalar (4B) = one dense 16-byte block, vs the 28B
    // a scalar-then-vec3 ordering would cost after re-alignment.
    expect(createStructLayout(packed).size).toBe(16);
  });
});
