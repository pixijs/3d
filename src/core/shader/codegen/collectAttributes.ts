import { warn } from 'pixi.js';
import type { VertexFormat } from 'pixi.js';

import type { ShaderBit } from '../ShaderBit';

function warnAttributeConflict(name: string, newFormat: string, existingFormat: string): void {
  warn(
    `[collectAttributes] Attribute "${name}" redefined with different format: ` +
      `"${existingFormat}" → "${newFormat}". Keeping original.`,
  );
}

/** @internal */
export function collectAttributes(bits: ShaderBit[]): Record<string, VertexFormat> {
  const attributes: Record<string, VertexFormat> = Object.create(null);

  for (const bit of bits) {
    if (!bit.attributes) continue;

    for (const [name, format] of Object.entries(bit.attributes)) {
      if (!(name in attributes)) {
        attributes[name] = format;
      } else if (attributes[name] !== format) {
        warnAttributeConflict(name, format, attributes[name]);
      }
    }
  }

  return attributes;
}
