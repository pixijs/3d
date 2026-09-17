import { WGSL_ALIGN_SIZE_DATA } from 'pixi.js';

/**
 * Per-field layout element describing where a struct field sits in memory
 *
 * Mirrors PixiJS's UboElement pattern — the layout pass computes these once, then both the WGSL
 * emitter and the sync function generator consume them.
 * @internal
 */
interface StructElement {
  /** Field name */
  name: string;
  /** WGSL type string */
  type: string;
  /** Byte offset from the start of the struct */
  offset: number;
  /** Byte size of this field */
  size: number;
  /** Number of 32-bit components (1 for f32, 3 for vec3, etc.) */
  components: number;
}

/**
 * Complete struct layout result
 * @internal
 */
interface StructLayout {
  /** Per-field layout elements, in declaration order */
  elements: StructElement[];
  /** Total struct size in bytes */
  size: number;
}

/**
 * Formats a layout as one `field: offset/size` line per element, for overflow diagnostics
 *
 * Shows the author exactly what to trim or pack.
 * @param layout - The layout to format
 * @returns One line per element
 * @internal
 */
export function formatStructLayout(layout: StructLayout): string {
  return layout.elements.map((e) => `  ${e.name}: ${e.type} @ byte ${e.offset}, ${e.size} bytes`).join('\n');
}

/**
 * Computes the memory layout for a struct given its field definitions
 *
 * Walks the fields in declaration order, applying Pixi's WGSL alignment rules to compute each
 * field's byte offset.
 * @param fields - Struct field definitions in declaration order
 *                 (e.g. `{ baseColor: 'vec4<f32>', roughness: 'f32' }`)
 * @returns The per-field elements and total struct size
 * @internal
 */
export function createStructLayout(fields: Record<string, string>): StructLayout {
  const elements: StructElement[] = [];
  let offset = 0;
  let maxAlign = 0;

  for (var name in fields) {
    const type = fields[name];
    const info = WGSL_ALIGN_SIZE_DATA[type];

    if (!info) continue;

    offset = Math.ceil(offset / info.align) * info.align;

    elements.push({
      name,
      type,
      offset,
      size: info.size,
      components: info.size / 4,
    });

    offset += info.size;
    maxAlign = Math.max(maxAlign, info.align);
  }

  return { elements, size: offset };
}
