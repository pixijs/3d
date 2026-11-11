import { WGSL_ALIGN_SIZE_DATA } from 'pixi.js';

interface StructElement {
  name: string;
  type: string;
  offset: number;
  size: number;
  /** Size in 32-bit words, so 4 for a `mat2x2<f32>` */
  components: number;
}

interface StructLayout {
  elements: StructElement[];
  /** Where the last field ends, in bytes, not rounded up to the struct's alignment as WGSL does */
  size: number;
}

/**
 * The material data class writes at these offsets and `layoutStructTexels` reads at them
 * @internal
 */
export function createStructLayout(fields: Record<string, string>): StructLayout {
  const elements: StructElement[] = [];
  let offset = 0;

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
  }

  return { elements, size: offset };
}
