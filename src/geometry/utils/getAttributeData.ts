import { getAttributeInfoFromFormat } from 'pixi.js';
import type { Attribute, Geometry } from 'pixi.js';

type ComponentView = {
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): ArrayLike<number>;
  readonly BYTES_PER_ELEMENT: number;
};

const COMPONENT_READERS: Record<string, { View: ComponentView; scale: number; min: number }> = {
  float32: { View: Float32Array, scale: 1, min: -Infinity },
  snorm8: { View: Int8Array, scale: 1 / 127, min: -1 },
  unorm8: { View: Uint8Array, scale: 1 / 255, min: -Infinity },
  sint8: { View: Int8Array, scale: 1, min: -Infinity },
  uint8: { View: Uint8Array, scale: 1, min: -Infinity },
  snorm16: { View: Int16Array, scale: 1 / 32767, min: -1 },
  unorm16: { View: Uint16Array, scale: 1 / 65535, min: -Infinity },
  sint16: { View: Int16Array, scale: 1, min: -Infinity },
  uint16: { View: Uint16Array, scale: 1, min: -Infinity },
  sint32: { View: Int32Array, scale: 1, min: -Infinity },
  uint32: { View: Uint32Array, scale: 1, min: -Infinity },
};

/**
 * Reads a vertex attribute as floats, `size` per vertex, however the geometry stores it
 *
 * Use it for maths on a mesh on the CPU, such as merging, welding or sampling its surface. Getters
 * such as {@link Geometry3D#normals} return data as stored, which can be quantized integers or a
 * whole interleaved buffer; this decodes either.
 *
 * Values come out as the vertex shader reads them: `snorm` formats as -1 to 1, `unorm` as 0 to 1,
 * and float and raw integer (`sint`, `uint`) formats as stored, so raw integer positions read in
 * the same space as {@link Geometry3D#bounds3D}, and the mesh's transform scales them. Morph
 * targets and skinning aren't applied.
 *
 * It copies on every call, so read once and keep the result, or pass `out` to reuse an array.
 * @example
 * ```ts
 * const normals = getAttributeData(geometry, 'aNormal', 3);
 * const normal = new Vector3().fromArray(normals, vertexIndex * 3);
 *
 * const merged = new Float32Array((first.vertexCount + second.vertexCount) * 3);
 * getAttributeData(first, 'aPosition', 3, merged);
 * getAttributeData(second, 'aPosition', 3, merged.subarray(first.vertexCount * 3));
 * ```
 * @param geometry - A {@link Geometry3D}, or a pixi `Geometry` whose attributes give a `format`,
 *   and a `stride` and `offset` when they share a buffer
 * @param attributeId - Shader attribute name, such as `aPosition`, `aNormal`, `aUV` or `aTangent`
 * @param size - Components per vertex to read, at most what the format holds: 3 for positions and
 *   normals, 2 for UVs, 4 for tangents
 * @param out - Array to fill from index 0, at least `size` floats per vertex; a new one is allocated
 *   when omitted
 * @returns `out`, or the new array
 * @category geometry
 * @standard
 */
export function getAttributeData(
  geometry: Geometry,
  attributeId: string,
  size: number,
  out?: Float32Array,
): Float32Array {
  const attribute: Attribute | undefined = geometry.getAttribute(attributeId);
  if (!attribute) throw new Error(`[getAttributeData] The geometry has no ${attributeId} attribute.`);

  const format = attribute.format;
  const reader = format && COMPONENT_READERS[format.split('x', 1)[0]];
  const info = reader && getAttributeInfoFromFormat(format);
  if (!info || size > info.size) {
    throw new Error(
      `[getAttributeData] Can't read ${attributeId}, stored as ${format ?? 'no format'}, as ${size} floats per vertex.`,
    );
  }

  const { View, scale, min } = reader;
  const data = attribute.buffer.data;
  const view = new View(data.buffer, data.byteOffset, Math.floor(data.byteLength / View.BYTES_PER_ELEMENT));
  const stride = (attribute.stride || info.stride) / View.BYTES_PER_ELEMENT;
  const offset = (attribute.offset ?? 0) / View.BYTES_PER_ELEMENT;
  const vertexCount = Math.floor(view.length / stride);
  const length = vertexCount * size;

  if (out && out.length < length) {
    throw new Error(`[getAttributeData] out holds ${out.length} floats, but ${attributeId} needs ${length}.`);
  }

  const result = out ?? new Float32Array(length);

  for (let v = 0; v < vertexCount; v++) {
    const src = v * stride + offset;
    const dst = v * size;
    for (let c = 0; c < size; c++) {
      const value = view[src + c] * scale;
      result[dst + c] = value < min ? min : value;
    }
  }

  return result;
}
