import type { GltfFormat } from '../GltfFormat';

type Component = 5120 | 5121 | 5122 | 5123 | 5125 | 5126;

const TypedMap: Record<Component, any> = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};

const BYTES_PER: Record<Component, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const NUM_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
} as const;

/**
 * Reads an accessor's data as a tightly packed typed array of the accessor's component type
 *
 * Tightly packed data comes back as a view of the source buffer, without a copy. Interleaved data
 * is copied out element by element, and a sparse accessor is decoded to a dense array.
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - The glTF binary buffers, indexed by `bufferView.buffer`
 * @param accessorIndex - Index of the accessor to read
 * @param copy - Return an array of its own, which outlives the source buffer. Only a view gets
 *   copied; the other paths already allocate.
 * @internal
 */
export function getBuffer(
  gltfRaw: GltfFormat,
  buffers: ArrayBuffer[],
  accessorIndex: number,
  copy = false,
): ArrayBufferView {
  const accessor = gltfRaw.accessors![accessorIndex];

  if (accessor.sparse) {
    return readSparseAccessor(gltfRaw, buffers, accessorIndex);
  }

  const bufferView = gltfRaw.bufferViews![accessor.bufferView!];
  const arrayBuffer: ArrayBuffer = buffers[bufferView.buffer];

  const componentType = accessor.componentType as Component;
  const TypeClass = TypedMap[componentType];
  const numComponents = NUM_COMPONENTS[accessor.type as keyof typeof NUM_COMPONENTS];

  const baseOffsetBytes = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const bytesPerComponent = BYTES_PER[componentType];
  const elementSizeBytes = numComponents * bytesPerComponent;
  const strideBytes = bufferView.byteStride ?? elementSizeBytes;
  const count = accessor.count;

  if (strideBytes === elementSizeBytes) {
    const view = new TypeClass(arrayBuffer, baseOffsetBytes, count * numComponents);
    return copy ? view.slice() : view;
  }

  const srcTyped = new TypeClass(arrayBuffer);
  const srcBase = baseOffsetBytes / bytesPerComponent;
  const strideElements = strideBytes / bytesPerComponent;
  const out = new TypeClass(count * numComponents);

  let dst = 0;
  for (let i = 0; i < count; i++) {
    const srcRow = srcBase + i * strideElements;
    for (let c = 0; c < numComponents; c++) {
      out[dst++] = srcTyped[srcRow + c];
    }
  }

  return out;
}

/**
 * Decodes a sparse accessor to a dense packed array: a copy of the base, with the listed elements
 * replaced
 *
 * Morph targets often ship this way, carrying offsets only for the vertices that move. Those are
 * VEC3, so three components get their own unrolled copy loop.
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - Binary buffers indexed by glTF buffer index
 * @param accessorIndex - Index of the sparse accessor to decode
 */
function readSparseAccessor(gltfRaw: GltfFormat, buffers: ArrayBuffer[], accessorIndex: number): ArrayBufferView {
  const accessor = gltfRaw.accessors![accessorIndex];
  const sparse = accessor.sparse!;
  const componentType = accessor.componentType as Component;
  const TypeClass = TypedMap[componentType];
  const numComponents = NUM_COMPONENTS[accessor.type as keyof typeof NUM_COMPONENTS];
  const total = accessor.count * numComponents;

  const out = new TypeClass(total);
  if (accessor.bufferView !== undefined) {
    const bufferView = gltfRaw.bufferViews![accessor.bufferView];
    const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    out.set(new TypeClass(buffers[bufferView.buffer], baseOffset, total));
  }

  const indicesView = gltfRaw.bufferViews![sparse.indices.bufferView];
  const IndexClass = TypedMap[sparse.indices.componentType as Component];
  const indices = new IndexClass(
    buffers[indicesView.buffer],
    (indicesView.byteOffset ?? 0) + (sparse.indices.byteOffset ?? 0),
    sparse.count,
  );
  const valuesView = gltfRaw.bufferViews![sparse.values.bufferView];
  const values = new TypeClass(
    buffers[valuesView.buffer],
    (valuesView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0),
    sparse.count * numComponents,
  );

  if (numComponents === 3) {
    for (let i = 0; i < sparse.count; i++) {
      const d = indices[i] * 3;
      const s = i * 3;
      out[d] = values[s];
      out[d + 1] = values[s + 1];
      out[d + 2] = values[s + 2];
    }
  } else {
    for (let i = 0; i < sparse.count; i++) {
      const dstBase = indices[i] * numComponents;
      const srcBase = i * numComponents;
      for (let c = 0; c < numComponents; c++) out[dstBase + c] = values[srcBase + c];
    }
  }

  return out;
}
