// Main-thread façade for the Draco decode worker.
//
// Lifecycle: the worker (and its WASM module) is lazy — nothing is created
// until the first `loadDracoOnWorker()` call. A non-Draco glTF therefore pays
// zero runtime cost for this module beyond evaluating these few function
// declarations.
//
// Concurrency: we currently use ONE shared worker. Multiple in-flight decodes
// all post-message into its single MessageChannel and execute serially on the
// worker thread. Callers (e.g. `processMeshes`) already Promise.all across
// every primitive, so a future worker pool would be a drop-in win — see
// https://github.com/pixijs/pixi-3d/issues/45.
//
// Request/response correlation: each decode is tagged with a monotonically
// increasing `id`. The worker echoes the id back on completion; we use it to
// look up the right resolver/rejecter and clean both maps up.
import { dracoDecoderUrls } from '../setDracoDecoderPath';

/**
 * How the worker should decode one Draco-compressed attribute
 * @internal
 */
export interface DracoAttributeRequest {
  /** Draco attribute uniqueId — the value held in `KHR_draco_mesh_compression.attributes[semantic]` */
  dracoId: number;
  /** The glTF accessor `componentType` enum (5120–5126); tells the worker how to interpret raw bytes */
  componentType: number;
}

/**
 * Decoded primitive data returned by the Draco worker
 * @internal
 */
interface DracoDecodeResult {
  /** 16-bit when the mesh has ≤65,535 vertices, otherwise 32-bit */
  indices: Uint16Array | Uint32Array;
  /** Decoded attribute buffers keyed by glTF semantic (e.g. 'POSITION', 'NORMAL') */
  attributes: Record<string, ArrayBufferView>;
}

interface DecodeMessage {
  id: number;
  success: boolean;
  indices?: Uint16Array | Uint32Array;
  attributes?: Record<string, ArrayBufferView>;
  error?: string;
}

let dracoWorker: Worker | undefined;
let nextId = 0;
// Two maps instead of one keep response-handler logic free of conditional
// destructuring — at the cost of one extra `delete` per response.
const resolvers: Record<number, (value: DracoDecodeResult) => void> = {};
const rejecters: Record<number, (reason: Error) => void> = {};

function rejectAllInFlight(reason: string): void {
  for (const id in rejecters) {
    rejecters[id](new Error(`Draco worker: ${reason}`));
    delete resolvers[id];
    delete rejecters[id];
  }
  // Worker's message channel is likely dead — terminate and drop the reference
  // so the next loadDracoOnWorker() call lazily spins up a fresh worker
  // instead of postMessaging into a broken one (which would hang silently).
  dracoWorker?.terminate();
  dracoWorker = undefined;
}

function getDracoWorker(): Worker {
  if (!dracoWorker) {
    // Classic worker (no `type: 'module'`) so the worker can use `importScripts` to
    // load Google's Draco decoder glue — module workers don't support importScripts.
    // The library build inlines this file as a blob URL; see scripts/build/inline-worker.mts.
    dracoWorker = new Worker(new URL('./draco.worker.ts', import.meta.url));

    dracoWorker.onmessage = (event: MessageEvent<DecodeMessage>) => {
      const { id, success, indices, attributes, error } = event.data;
      // Guard against unknown/stale ids — silently ignoring is safer than
      // crashing the message loop and stranding every in-flight promise.
      if (success && indices && attributes) {
        resolvers[id]?.({ indices, attributes });
      } else {
        rejecters[id]?.(new Error(error ?? 'Draco decode failed'));
      }
      delete resolvers[id];
      delete rejecters[id];
    };

    // Worker-level failures (uncaught errors, serialization failures) break the
    // message channel — reject every in-flight promise so callers don't hang.
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
 * IMPORTANT: `bufferViewBytes` is **transferred** (not copied) to the worker.
 * After this call the caller's reference to that ArrayBuffer is detached and
 * unusable. Callers that need to keep the bytes around must pass a slice/copy.
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
