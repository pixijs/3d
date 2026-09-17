// Main-thread entry point for EXT_meshopt_compression / KHR_meshopt_compression.
//
// Unlike Draco (which is per-primitive and needs attribute-ID remapping), meshopt
// is per-bufferView and produces opaque decoded bytes that slot back into the
// bufferView. That lets us decode every compressed bufferView up-front and
// rewrite gltfRaw in place. Called from normalizeMeshopt, which then compacts
// the buffers array so the rest of the pipeline sees a plain glTF.
//
// Both extension names are recognized: `EXT_meshopt_compression` is the
// original (four years old, what gltfpack still emits by default) and
// `KHR_meshopt_compression` is the successor with a revised binary format.
// The meshoptimizer decoder handles both transparently — only the JSON key
// differs.
//
// Worker pool: the `meshoptimizer` package ships its own worker pool via
// `useWorkers(count)` + `decodeGltfBufferAsync`. We pay ~zero integration cost
// for off-threaded decode, which matters for any non-trivial asset: a 1M-vert
// mesh would jank the main thread for 150–300ms otherwise.
import type { GltfFormat } from '../GltfFormat';

// oxlint-disable-next-line typescript/consistent-type-imports
type MeshoptDecoder = typeof import('meshoptimizer/decoder').MeshoptDecoder;

let decoderPromise: Promise<MeshoptDecoder> | undefined;

function getDecoder(): Promise<MeshoptDecoder> {
  if (!decoderPromise) {
    // Dynamic import of the decoder entry alone (the package root also pulls in the
    // encoder and simplifier). Its chunk, with base64-inlined WASM, is fetched only
    // when a meshopt-compressed asset is actually loaded; non-meshopt consumers pay
    // zero runtime cost beyond the extensionsUsed early-out in normalizeMeshopt.
    decoderPromise = (async () => {
      const { MeshoptDecoder } = await import('meshoptimizer/decoder');
      await MeshoptDecoder.ready;
      const poolSize = Math.max(1, Math.min((navigator.hardwareConcurrency ?? 4) - 1, 4));
      MeshoptDecoder.useWorkers(poolSize);
      return MeshoptDecoder;
    })();
  }

  return decoderPromise;
}

/**
 * Decodes every bufferView that declares EXT_meshopt_compression or KHR_meshopt_compression
 *
 * Mutates the `buffers` array by appending decoded payloads, and rewrites each
 * compressed bufferView's `buffer`/`byteOffset`/`byteLength` to point at the new
 * entry. The extension entry is deleted to guarantee no double-decode.
 * @param gltfRaw - Parsed glTF JSON whose compressed bufferViews are rewritten in place
 * @param buffers - Binary buffers holding the compressed source; decoded payloads are appended
 * @internal
 */
export async function decodeMeshoptBufferViews(gltfRaw: GltfFormat, buffers: ArrayBuffer[]): Promise<void> {
  const bufferViews = gltfRaw.bufferViews;
  if (!bufferViews) return;

  const decoder = await getDecoder();

  await Promise.all(
    bufferViews.map(async (bv) => {
      const ext = bv.extensions?.EXT_meshopt_compression ?? bv.extensions?.KHR_meshopt_compression;
      if (!ext) return;

      const sourceBuffer: ArrayBuffer = buffers[ext.buffer];
      const source = new Uint8Array(sourceBuffer, ext.byteOffset ?? 0, ext.byteLength);

      const decoded = await decoder.decodeGltfBufferAsync(
        ext.count,
        ext.byteStride,
        source,
        ext.mode,
        ext.filter ?? 'NONE',
      );

      // Append the decoded bytes as a new entry in `buffers` and repoint the
      // bufferView at it. byteStride is preserved — interleaved accessors rely
      // on it. Deleting the extension guarantees no second decode pass ever
      // attempts to re-parse this (now-uncompressed) data.
      const newIndex = buffers.length;
      buffers.push(decoded.buffer as ArrayBuffer);
      bv.buffer = newIndex;
      bv.byteOffset = 0;
      bv.byteLength = ext.count * ext.byteStride;

      delete bv.extensions?.EXT_meshopt_compression;
      delete bv.extensions?.KHR_meshopt_compression;
    }),
  );
}
