// Classic worker (no ESM imports). Loads Google's Draco decoder glue via
// importScripts, initializes the WASM module once, then handles per-primitive
// decode requests.
//
// Protocol:
//   Main → worker: { type: 'init', jsUrl, wasmUrl }
//                  { type: 'decode', id, bufferViewBytes, attributeIds: { [semantic]: { dracoId, componentType } } }
//   Worker → main: { id, success, indices?, attributes?, error? }

// oxlint-disable no-console

// The Draco glue that `importScripts` loads defines `DracoDecoderModule` on the worker global.
declare const self: DedicatedWorkerGlobalScope & {
  DracoDecoderModule: (config?: { wasmBinary?: ArrayBuffer }) => Promise<DracoModule>;
};

interface DracoModule {
  Decoder: new () => DracoDecoder;
  DecoderBuffer: new () => DracoDecoderBuffer;
  Mesh: new () => DracoMesh;
  _malloc(size: number): number;
  _free(ptr: number): void;
  destroy(obj: unknown): void;
  HEAPU8: Uint8Array;
  // Draco DT_* enum — exposed as numbered properties on the module.
  DT_INT8: number;
  DT_UINT8: number;
  DT_INT16: number;
  DT_UINT16: number;
  DT_UINT32: number;
  DT_FLOAT32: number;
}

interface DracoDecoder {
  DecodeBufferToMesh(buffer: DracoDecoderBuffer, outMesh: DracoMesh): DracoStatus;
  GetTrianglesUInt16Array(mesh: DracoMesh, outSize: number, outPtr: number): void;
  GetTrianglesUInt32Array(mesh: DracoMesh, outSize: number, outPtr: number): void;
  GetAttributeByUniqueId(mesh: DracoMesh, uniqueId: number): DracoAttribute;
  GetAttributeDataArrayForAllPoints(
    mesh: DracoMesh,
    attribute: DracoAttribute,
    dataType: number,
    outSize: number,
    outPtr: number,
  ): void;
}

interface DracoDecoderBuffer {
  Init(data: Int8Array, size: number): void;
}

interface DracoMesh {
  num_faces(): number;
  num_points(): number;
}

interface DracoAttribute {
  num_components(): number;
}

interface DracoStatus {
  ok(): boolean;
  error_msg(): string;
}

interface AttributeRequest {
  dracoId: number;
  componentType: number;
}

let modulePromise: Promise<DracoModule> | undefined;
// Decoder is stateless between calls — reuse across all primitive decodes for
// the worker's lifetime. Mesh + DecoderBuffer still get allocated per-call.
let sharedDecoder: DracoDecoder | undefined;

async function initDecoder(jsUrl: string, wasmUrl: string): Promise<DracoModule> {
  // Resolve relative URLs against the page origin — important when the worker
  // was instantiated with a blob URL or a non-HTTP location.
  const absJsUrl = new URL(jsUrl, self.location.origin).href;
  const absWasmUrl = new URL(wasmUrl, self.location.origin).href;

  importScripts(absJsUrl);

  const wasmBinary = await fetch(absWasmUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch Draco WASM: ${r.status} ${r.statusText}`);
    return r.arrayBuffer();
  });

  return await self.DracoDecoderModule({ wasmBinary });
}

// Generic typed-array constructor + slice() shape — every TypedArray prototype
// has both, but TS lacks a single union for "any TypedArray ctor" so we hand-roll.
type TypedArrayCtor = new (
  buf: ArrayBufferLike,
  offset: number,
  len: number,
) => ArrayBufferView & {
  slice(): ArrayBufferView & { buffer: ArrayBufferLike };
};

type DracoDtKey = 'DT_INT8' | 'DT_UINT8' | 'DT_INT16' | 'DT_UINT16' | 'DT_UINT32' | 'DT_FLOAT32';

interface ComponentInfo {
  ctor: TypedArrayCtor;
  bytes: 1 | 2 | 4;
  dtKey: DracoDtKey;
}

// Single source of truth for every glTF componentType we support: the matching
// TypedArray constructor, its element size in bytes, and the Draco DT_* enum
// key on the WASM module.
const COMPONENT_INFO: Record<number, ComponentInfo> = {
  5120: { ctor: Int8Array as unknown as TypedArrayCtor, bytes: 1, dtKey: 'DT_INT8' },
  5121: { ctor: Uint8Array as unknown as TypedArrayCtor, bytes: 1, dtKey: 'DT_UINT8' },
  5122: { ctor: Int16Array as unknown as TypedArrayCtor, bytes: 2, dtKey: 'DT_INT16' },
  5123: { ctor: Uint16Array as unknown as TypedArrayCtor, bytes: 2, dtKey: 'DT_UINT16' },
  5125: { ctor: Uint32Array as unknown as TypedArrayCtor, bytes: 4, dtKey: 'DT_UINT32' },
  5126: { ctor: Float32Array as unknown as TypedArrayCtor, bytes: 4, dtKey: 'DT_FLOAT32' },
};

/**
 * Decodes one Draco-compressed primitive into JS-side typed arrays ready to post back across the worker boundary
 *
 * Memory discipline: every WASM-side allocation (mesh, buffer, malloc'd ptrs)
 * is released in the `finally` block — `pendingPtr` tracks whichever malloc
 * is currently live so a throw mid-loop can't leak the heap.
 *
 * Returns `transferables` so the caller can hand them off zero-copy via
 * `postMessage`'s second argument; the returned `indices`/`attributes` arrays
 * become detached on the worker side once that happens.
 * @param bufferViewBytes - Compressed bytes of the primitive's Draco bufferView
 * @param attributeIds - Attributes to decode, keyed by glTF semantic, with their Draco ids and component types
 */
async function decodePrimitive(
  bufferViewBytes: ArrayBuffer,
  attributeIds: Record<string, AttributeRequest>,
): Promise<{
  indices: Uint16Array | Uint32Array;
  attributes: Record<string, ArrayBufferView>;
  transferables: ArrayBuffer[];
}> {
  if (!modulePromise) throw new Error('Draco decoder not initialized');
  const module = await modulePromise;

  // Decoder is stateless between calls — one shared instance per worker
  // lifetime is safe and avoids the (non-trivial) construction cost.
  if (!sharedDecoder) sharedDecoder = new module.Decoder();
  const decoder = sharedDecoder;

  // Allocations that must always be released — track them so the finally
  // block can clean up regardless of which line throws.
  const buffer = new module.DecoderBuffer();
  const mesh = new module.Mesh();
  let pendingPtr = 0;

  try {
    buffer.Init(new Int8Array(bufferViewBytes), bufferViewBytes.byteLength);

    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    if (!status.ok()) throw new Error(`Draco decode failed: ${status.error_msg()}`);

    const numFaces = mesh.num_faces();
    const numIndices = numFaces * 3;
    const numPoints = mesh.num_points();

    // Pick 16-bit indices whenever every vertex index can fit. Halves the
    // WASM heap allocation, postMessage transfer payload, and the eventual
    // GPU index buffer. Threshold is conservative (≤ 0xffff rather than
    // ≤ 0x10000) to stay clear of values some APIs treat as primitive-restart.
    const useShortIndices = numPoints <= 0xffff;
    const indexBytes = useShortIndices ? 2 : 4;
    pendingPtr = module._malloc(numIndices * indexBytes);
    if (useShortIndices) {
      decoder.GetTrianglesUInt16Array(mesh, numIndices * 2, pendingPtr);
    } else {
      decoder.GetTrianglesUInt32Array(mesh, numIndices * 4, pendingPtr);
    }
    const IndexCtor = useShortIndices ? Uint16Array : Uint32Array;
    const indices = new IndexCtor(module.HEAPU8.buffer as ArrayBuffer, pendingPtr, numIndices).slice();
    module._free(pendingPtr);
    pendingPtr = 0;

    const attributes: Record<string, ArrayBufferView> = {};
    const transferables: ArrayBuffer[] = [indices.buffer as ArrayBuffer];

    const semantics = Object.keys(attributeIds);
    for (let i = 0; i < semantics.length; i++) {
      const semantic = semantics[i];
      const { dracoId, componentType } = attributeIds[semantic];

      const info = COMPONENT_INFO[componentType];
      if (!info) throw new Error(`Unsupported Draco componentType: ${componentType}`);

      const attribute = decoder.GetAttributeByUniqueId(mesh, dracoId);
      if (!attribute) throw new Error(`Draco attribute not found for uniqueId ${dracoId}`);

      const totalComponents = numPoints * attribute.num_components();
      const byteSize = totalComponents * info.bytes;
      pendingPtr = module._malloc(byteSize);
      decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, module[info.dtKey], byteSize, pendingPtr);
      // .slice() copies natively from the WASM heap without zero-initializing
      // a destination buffer first (unlike `new TypedArray(len) + set()`).
      const copy = new info.ctor(module.HEAPU8.buffer, pendingPtr, totalComponents).slice();
      module._free(pendingPtr);
      pendingPtr = 0;
      attributes[semantic] = copy;
      transferables.push(copy.buffer as ArrayBuffer);
    }

    return { indices, attributes, transferables };
  } finally {
    if (pendingPtr) module._free(pendingPtr);
    module.destroy(mesh);
    module.destroy(buffer);
    // sharedDecoder is intentionally NOT destroyed — reused across primitives.
  }
}

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;

  if (message.type === 'init') {
    // Keep the rejected promise around so subsequent decode attempts surface
    // the real initialization error (e.g. CDN 404, WASM fetch failure) instead
    // of a generic "decoder not initialized" message.
    modulePromise = initDecoder(message.jsUrl, message.wasmUrl);
    return;
  }

  if (message.type === 'decode') {
    try {
      const { indices, attributes, transferables } = await decodePrimitive(
        message.bufferViewBytes,
        message.attributeIds,
      );
      self.postMessage({ id: message.id, success: true, indices, attributes }, transferables);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      self.postMessage({ id: message.id, success: false, error });
    }
  }
};
