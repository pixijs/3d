import { WGSL_ALIGN_SIZE_DATA } from 'pixi.js';

/**
 * Where one struct field sits in memory
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
  /** Its size in 32-bit words: 1 for `f32`, 3 for `vec3<f32>`, 4 for `mat2x2<f32>` */
  components: number;
}

/**
 * A struct's field offsets and size
 * @internal
 */
interface StructLayout {
  /** One element per field, in declaration order */
  elements: StructElement[];
  /** The byte offset where the last field ends, not rounded up to the struct's alignment as WGSL does */
  size: number;
}

/**
 * Formats a layout as one line per field, with its type, offset and size, for the error a struct
 * too big for the material store throws
 * @param layout - The layout to format
 * @returns One line per element
 * @internal
 */
export function formatStructLayout(layout: StructLayout): string {
  return layout.elements.map((e) => `  ${e.name}: ${e.type} @ byte ${e.offset}, ${e.size} bytes`).join('\n');
}

/**
 * Lays out a struct's fields in declaration order, aligning each by pixi's `WGSL_ALIGN_SIZE_DATA`
 *
 * The material data class writes a material's values at these offsets, and `layoutMaterialTexels`
 * reads the shader's fields from them, so both sides agree. A field whose type pixi has no entry
 * for is left out.
 * @param fields - Field types in declaration order, such as `{ baseColor: 'vec4<f32>', roughness: 'f32' }`
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
