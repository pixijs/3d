import { WGSL_ALIGN_SIZE_DATA } from 'pixi.js';

import type { StructDefinition } from '../ShaderBit';

/**
 * Returns a copy of `def` with fields reordered to pack tightly under WGSL struct layout rules
 *
 * Fields sort by `(align desc, size desc, declaration index asc)` — mat/vec4 → vec3 → vec2 →
 * scalars — then one 4-byte scalar is pulled forward behind each vec3: vec3 is align 16 / size
 * 12, so the scalar fills its tail hole and the pair forms a dense 16-byte block.
 *
 * The resulting layout is hole-free whenever the def has at least as many scalars as vec3s; each
 * leftover vec3 pads its last 4 bytes. Declaration order is preserved within a tier (and within
 * the pulled scalars), so the layout is deterministic for a given def. Types without a
 * `WGSL_ALIGN_SIZE_DATA` entry (e.g. `array<f32, N>` padding) sort last, keeping their relative
 * order.
 *
 * Tight packing keeps the merged Material struct under the storage stride no matter how bits
 * order their declarations, and becomes a direct memory win once the stride is variable per
 * material.
 * @param def - Struct field definitions in declaration order
 * @returns A new definition with the same fields in packed order
 * @internal
 */
export function packStructFields(def: StructDefinition): StructDefinition {
  const entries = Object.keys(def).map((name, index) => {
    const info = WGSL_ALIGN_SIZE_DATA[def[name]];

    return { name, align: info?.align ?? 0, size: info?.size ?? 0, index };
  });

  entries.sort((a, b) => b.align - a.align || b.size - a.size || a.index - b.index);

  const wide = entries.filter((e) => e.align >= 8);
  const scalars = entries.filter((e) => e.align > 0 && e.align < 8);
  const unknown = entries.filter((e) => e.align === 0);

  const packed: StructDefinition = {};
  let scalarCursor = 0;

  for (const e of wide) {
    packed[e.name] = def[e.name];

    // vec3 tail: one scalar completes the dense 16-byte block.
    if (e.align === 16 && e.size === 12 && scalarCursor < scalars.length) {
      const s = scalars[scalarCursor++];
      packed[s.name] = def[s.name];
    }
  }

  for (let i = scalarCursor; i < scalars.length; i++) packed[scalars[i].name] = def[scalars[i].name];
  for (const e of unknown) packed[e.name] = def[e.name];

  return packed;
}
