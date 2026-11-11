import { dracoDecoderUrls } from '../setDracoDecoderPath';

/**
 * Mirrored by `AttributeRequest` in `draco.worker.ts`
 * @internal
 */
export interface DracoAttributeRequest {
  dracoId: number;
  componentType: number;
}

interface DracoDecodeResult {
  indices: Uint16Array | Uint32Array;
  attributes: Record<string, ArrayBufferView>;
}

/** The reply `draco.worker.ts` posts for one decode */
interface DecodeMessage {
  id: number;
  success: boolean;
  indices?: Uint16Array | Uint32Array;
  attributes?: Record<string, ArrayBufferView>;
  error?: string;
}

/**
 * A classic worker, as the decoder loads through `importScripts`. Keep the `new URL` form that starts
 * it: `scripts/build/inline-worker.mts` matches it to inline the worker
 */
let dracoWorker: Worker | undefined;
let nextId = 0;
const resolvers: Record<number, (value: DracoDecodeResult) => void> = {};
const rejecters: Record<number, (reason: Error) => void> = {};

/** Rejects every pending decode and drops the worker, so the next decode starts a fresh one */
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
 * Transfers `bufferViewBytes` to the worker, so pass a copy to keep the bytes
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
