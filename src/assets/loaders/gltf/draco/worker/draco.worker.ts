/** The Draco glue that `importScripts` loads defines `DracoDecoderModule` on the worker global */
declare const self: DedicatedWorkerGlobalScope & {
  DracoDecoderModule: (config?: { wasmBinary?: ArrayBuffer }) => Promise<DracoModule>;
};

/** The parts of Draco's decoder module the worker uses; the `DT_*` members are its data-type enum */
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

/** One attribute to decode; mirrors `DracoAttributeRequest` in `loadDracoOnWorker.ts` */
interface AttributeRequest {
  dracoId: number;
  componentType: number;
}

/**
 * The decoder module, set by the `init` message
 *
 * A failed init stays here as a rejected promise, so each decode reports the real error, such as a
 * failed WASM fetch, rather than a missing decoder.
 */
let modulePromise: Promise<DracoModule> | undefined;
/** Draco's decoder keeps no state between decodes, so one serves the worker's whole life */
let sharedDecoder: DracoDecoder | undefined;

/**
 * Loads the Draco glue script and its WASM, then instantiates the module
 *
 * Relative URLs resolve against the page's origin, because the worker itself may run from a blob URL.
 * @param jsUrl - URL of Draco's JS glue
 * @param wasmUrl - URL of Draco's WASM decoder
 */
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

/** Any typed-array constructor, written out because TypeScript has no single type for one */
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

/** For each glTF component type: its typed array, its size in bytes, and the matching Draco data type */
const COMPONENT_INFO: Record<number, ComponentInfo> = {
  5120: { ctor: Int8Array as unknown as TypedArrayCtor, bytes: 1, dtKey: 'DT_INT8' },
  5121: { ctor: Uint8Array as unknown as TypedArrayCtor, bytes: 1, dtKey: 'DT_UINT8' },
  5122: { ctor: Int16Array as unknown as TypedArrayCtor, bytes: 2, dtKey: 'DT_INT16' },
  5123: { ctor: Uint16Array as unknown as TypedArrayCtor, bytes: 2, dtKey: 'DT_UINT16' },
  5125: { ctor: Uint32Array as unknown as TypedArrayCtor, bytes: 4, dtKey: 'DT_UINT32' },
  5126: { ctor: Float32Array as unknown as TypedArrayCtor, bytes: 4, dtKey: 'DT_FLOAT32' },
};

/**
 * Decodes one Draco-compressed primitive into typed arrays to post back to the main thread
 *
 * Every WASM allocation is released in the `finally` block, with `pendingPtr` holding whichever
 * `_malloc` is live, so a throw partway through leaks nothing. Data leaves the WASM heap through
 * `slice()`, which copies without zero-filling a new array first.
 *
 * Indices are 16-bit when there are at most 65,535 vertices. The largest index is then 65,534, clear
 * of 65,535, which graphics APIs can read as a primitive restart.
 *
 * `transferables` lets the caller post the arrays without copying them; they are detached in the
 * worker afterwards.
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

/**
 * Handles the messages `loadDracoOnWorker.ts` posts
 *
 * `{ type: 'init', jsUrl, wasmUrl }` starts loading the decoder. `{ type: 'decode', id,
 * bufferViewBytes, attributeIds }` decodes one primitive and replies with
 * `{ id, success, indices?, attributes?, error? }`.
 * @param event - The message from the main thread
 */
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
