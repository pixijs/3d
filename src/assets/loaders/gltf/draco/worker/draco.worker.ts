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

/** Mirrors `DracoAttributeRequest` in `loadDracoOnWorker.ts` */
interface AttributeRequest {
  dracoId: number;
  componentType: number;
}

/** Holds a failed init as a rejected promise, so each decode reports the real error */
let modulePromise: Promise<DracoModule> | undefined;
/** One decoder serves every decode, as Draco's keeps no state between them */
let sharedDecoder: DracoDecoder | undefined;

/** Resolves relative URLs against the page's origin, as the worker may run from a blob URL */
async function initDecoder(jsUrl: string, wasmUrl: string): Promise<DracoModule> {
  const absJsUrl = new URL(jsUrl, self.location.origin).href;
  const absWasmUrl = new URL(wasmUrl, self.location.origin).href;

  importScripts(absJsUrl);

  const wasmBinary = await fetch(absWasmUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch Draco WASM: ${r.status} ${r.statusText}`);
    return r.arrayBuffer();
  });

  return await self.DracoDecoderModule({ wasmBinary });
}

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

const COMPONENT_INFO: Record<number, ComponentInfo> = {
  5120: { ctor: Int8Array, bytes: 1, dtKey: 'DT_INT8' },
  5121: { ctor: Uint8Array, bytes: 1, dtKey: 'DT_UINT8' },
  5122: { ctor: Int16Array, bytes: 2, dtKey: 'DT_INT16' },
  5123: { ctor: Uint16Array, bytes: 2, dtKey: 'DT_UINT16' },
  5125: { ctor: Uint32Array, bytes: 4, dtKey: 'DT_UINT32' },
  5126: { ctor: Float32Array, bytes: 4, dtKey: 'DT_FLOAT32' },
};

/**
 * `pendingPtr` holds the live `_malloc`, which `finally` frees, so a throw leaks nothing. Indices are
 * 16-bit up to 65,535 vertices, so the largest, 65,534, stays clear of the primitive restart value
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

  if (!sharedDecoder) sharedDecoder = new module.Decoder();
  const decoder = sharedDecoder;

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
    const transferables: ArrayBuffer[] = [indices.buffer];

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
  }
}

/** Handles the `init` and `decode` messages `loadDracoOnWorker.ts` posts */
async function handleMessage(event: MessageEvent): Promise<void> {
  const message = event.data;

  if (message.type === 'init') {
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
}

self.onmessage = handleMessage;
