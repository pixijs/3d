import { WGSL_ALIGN_SIZE_DATA } from 'pixi.js';

import type { StructDefinition } from '../ShaderBit';

/**
 * Returns a copy of `def` with its fields reordered to pack tightly under WGSL layout rules
 *
 * Fields sort by alignment, largest first, then by size, largest first, then in declaration order.
 * Then each `vec3` takes the next 4-byte scalar right behind it: a `vec3` is 16-aligned but 12
 * bytes long, so the scalar fills the gap and the pair makes a solid 16 bytes.
 *
 * The result has no gaps as long as there are at least as many scalars as `vec3`s; each `vec3`
 * left over pads its last 4 bytes. Ties keep declaration order, so one `def` always packs the same
 * way. Types `WGSL_ALIGN_SIZE_DATA` doesn't know go last, in their declared order.
 *
 * Packing keeps the merged `Material` struct inside the store stride however its bits order their
 * fields.
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

    if (e.align === 16 && e.size === 12 && scalarCursor < scalars.length) {
      const s = scalars[scalarCursor++];
      packed[s.name] = def[s.name];
    }
  }

  for (let i = scalarCursor; i < scalars.length; i++) packed[scalars[i].name] = def[scalars[i].name];
  for (const e of unknown) packed[e.name] = def[e.name];

  return packed;
}
