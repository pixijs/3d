import { WGSL_ALIGN_SIZE_DATA } from 'pixi.js';

import type { StructDefinition } from '../ShaderBit';

/**
 * Ties keep declaration order, so one `def` always packs the same way
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
