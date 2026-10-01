import { dracoDecoderUrls } from '../setDracoDecoderPath';

/**
 * How the worker should decode one Draco-compressed attribute
 * @internal
 */
export interface DracoAttributeRequest {
  /** The attribute's id in the Draco data, from `KHR_draco_mesh_compression.attributes` */
  dracoId: number;
  /** The glTF accessor's `componentType`, which the decoded values are converted to */
  componentType: number;
}

/**
 * Decoded primitive data returned by the Draco worker
 * @internal
 */
interface DracoDecodeResult {
  /** 16-bit when the mesh has at most 65,535 vertices, otherwise 32-bit */
  indices: Uint16Array | Uint32Array;
  /** Decoded attribute buffers keyed by glTF semantic (e.g. 'POSITION', 'NORMAL') */
  attributes: Record<string, ArrayBufferView>;
}

/** The worker's reply to one decode request, carrying the request's `id` */
interface DecodeMessage {
  id: number;
  success: boolean;
  indices?: Uint16Array | Uint32Array;
  attributes?: Record<string, ArrayBufferView>;
  error?: string;
}

/**
 * The Draco worker, which `getDracoWorker` starts on the first decode, so a file without Draco
 * never pays for it
 *
 * It's a classic worker, not a module one, because it loads the decoder with `importScripts`, which
 * module workers lack. The library build inlines it as a blob URL (`scripts/build/inline-worker.mts`).
 *
 * The worker's first message is `{ type: 'init', jsUrl, wasmUrl }`. Each decode then posts
 * `{ type: 'decode', id, bufferViewBytes, attributeIds }`, and `draco.worker.ts` answers with a
 * {@link DecodeMessage} carrying the same `id`. A reply whose `id` is no longer pending is ignored.
 */
let dracoWorker: Worker | undefined;
let nextId = 0;
const resolvers: Record<number, (value: DracoDecodeResult) => void> = {};
const rejecters: Record<number, (reason: Error) => void> = {};

/**
 * Rejects every pending decode and drops the worker
 *
 * Runs when the worker itself fails, which breaks its message channel. The next decode then starts a
 * fresh worker instead of posting to the broken one and waiting forever.
 * @param reason - Why the worker failed, for the rejection message
 */
function rejectAllInFlight(reason: string): void {
  for (const id in rejecters) {
    rejecters[id](new Error(`Draco worker: ${reason}`));
    delete resolvers[id];
    delete rejecters[id];
  }
  dracoWorker?.terminate();
  dracoWorker = undefined;
}

function getDracoWorker(): Worker {
  if (!dracoWorker) {
    dracoWorker = new Worker(new URL('./draco.worker.ts', import.meta.url));

    dracoWorker.onmessage = (event: MessageEvent<DecodeMessage>) => {
      const { id, success, indices, attributes, error } = event.data;
      if (success && indices && attributes) {
        resolvers[id]?.({ indices, attributes });
      } else {
        rejecters[id]?.(new Error(error ?? 'Draco decode failed'));
      }
      delete resolvers[id];
      delete rejecters[id];
    };

    dracoWorker.onerror = (event) => rejectAllInFlight(event.message || 'uncaught error');
    dracoWorker.onmessageerror = () => rejectAllInFlight('message deserialization failed');

    dracoWorker.postMessage({
      type: 'init',
      jsUrl: dracoDecoderUrls.jsUrl,
      wasmUrl: dracoDecoderUrls.wasmUrl,
    });
  }

  return dracoWorker;
}

/**
 * Sends a single Draco-compressed primitive to the worker for decoding
 *
 * `bufferViewBytes` is transferred to the worker, not copied, so it is detached once this returns;
 * pass a copy to keep the bytes. All decodes share one worker and run one after another
 * (https://github.com/pixijs/pixi-3d/issues/45 tracks a pool).
 * @param bufferViewBytes - Compressed bytes of the primitive's Draco bufferView; detached after the call
 * @param attributeIds - Attributes to decode, keyed by glTF semantic, with their Draco ids and component types
 * @internal
 */
export function loadDracoOnWorker(
  bufferViewBytes: ArrayBuffer,
  attributeIds: Record<string, DracoAttributeRequest>,
): Promise<DracoDecodeResult> {
  const worker = getDracoWorker();
  const id = nextId++;

  return new Promise<DracoDecodeResult>((resolve, reject) => {
    resolvers[id] = resolve;
    rejecters[id] = reject;
    worker.postMessage({ type: 'decode', id, bufferViewBytes, attributeIds }, [bufferViewBytes]);
  });
}
