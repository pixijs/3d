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
 * Reads an accessor's data as a packed typed array of the accessor's component type
 * @param gltfRaw - Parsed glTF JSON
 * @param buffers - The glTF binary buffers, indexed by `bufferView.buffer`
 * @param accessorIndex - Index of the accessor to read
 * @param copy - Guarantee an owned array the caller can outlive the source buffer with.
 *   Only the tightly-packed fast path returns a view; the sparse and interleaved paths
 *   already allocate, so `copy` costs nothing there.
 * @internal
 */
export function getBuffer(
  gltfRaw: GltfFormat,
  buffers: ArrayBuffer[],
  accessorIndex: number,
  copy = false,
): ArrayBufferView {
  const accessor = gltfRaw.accessors![accessorIndex];

  // Sparse accessors (common for morph targets — only a few vertices deviate)
  // displace a base over a subset of indices. Decode to a dense array so the
  // rest of the pipeline (which expects packed data) never sees the sparsity.
  if (accessor.sparse) {
    return readSparseAccessor(gltfRaw, buffers, accessorIndex);
  }

  const bufferView = gltfRaw.bufferViews![accessor.bufferView!];
  const arrayBuffer: ArrayBuffer = buffers[bufferView.buffer];

  const componentType = accessor.componentType as Component;
  const TypeClass = TypedMap[componentType];
  const numComponents = NUM_COMPONENTS[accessor.type as keyof typeof NUM_COMPONENTS];

  const baseOffsetBytes = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const bytesPerComponent = BYTES_PER[componentType]; // bytes per component
  const elementSizeBytes = numComponents * bytesPerComponent; // bytes per element (the accessor's item)
  const strideBytes = bufferView.byteStride ?? elementSizeBytes;
  const count = accessor.count;

  // Fast path: tightly packed. Return a zero-copy view over the source buffer,
  // or an owned copy of it when the caller must outlive that buffer (`copy`).
  if (strideBytes === elementSizeBytes) {
    const view = new TypeClass(arrayBuffer, baseOffsetBytes, count * numComponents);
    return copy ? view.slice() : view;
  }

  // Interleaved path: de-interleave into a packed array using a typed view for speed.
  const srcTyped = new TypeClass(arrayBuffer); // view over entire buffer
  const srcBase = baseOffsetBytes / bytesPerComponent; // convert byte offset to element index
  const strideElements = strideBytes / bytesPerComponent; // convert stride to element count
  const out = new TypeClass(count * numComponents);

  // Copy each logical element (i) and its components (c)
  // src index for component c of element i: srcBase + i*strideElems + c
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
 * Decodes a sparse accessor to a dense packed array
 *
 * The result is a base (the accessor's bufferView, or all zeros when it has none) with
 * `sparse.count` entries displaced at `sparse.indices`. glTF morph targets commonly ship this
 * way — only the vertices that move carry deltas, over a zero base.
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

  // Base: a mutable copy of the (tightly packed) bufferView, or zeros when absent.
  const out = new TypeClass(total);
  if (accessor.bufferView !== undefined) {
    const bufferView = gltfRaw.bufferViews![accessor.bufferView];
    const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    out.set(new TypeClass(buffers[bufferView.buffer], baseOffset, total));
  }

  // Displace: for each entry, out[index] = value.
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

  // Scatter each entry's components into the dense output. The inner
  // component copy is the decode's hot cost (the zero-fill is lazy and cheap),
  // so VEC3 — position/normal morph deltas, the overwhelming case — is unrolled;
  // V8 can't unroll a variable trip count, and this measures ~30% faster.
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
