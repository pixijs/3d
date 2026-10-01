import type { GltfFormat } from '../GltfFormat';

// oxlint-disable-next-line typescript/consistent-type-imports
type MeshoptDecoder = typeof import('meshoptimizer/decoder').MeshoptDecoder;

let decoderPromise: Promise<MeshoptDecoder> | undefined;

/**
 * Imports the meshoptimizer decoder on first use and starts its worker pool
 *
 * It imports the decoder entry alone, as the package root also pulls in the encoder and the
 * simplifier. That chunk carries the decoder's WASM inline, so a page that never loads a
 * meshopt-compressed file never downloads it. Decoding runs on one worker fewer than the device has
 * cores, between one and four, so a large mesh doesn't stall the main thread.
 */
function getDecoder(): Promise<MeshoptDecoder> {
  if (!decoderPromise) {
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
 * Decodes every bufferView compressed with `EXT_meshopt_compression` or `KHR_meshopt_compression`
 *
 * Meshopt compresses whole bufferViews, so each decodes on its own, ahead of parsing. Its decoded
 * bytes are appended to `buffers`, and the view's `buffer`, `byteOffset` and `byteLength` are
 * rewritten to point at them; `byteStride` stays, as interleaved accessors read it. The extension
 * entry is then deleted, so nothing decodes the view twice. The decoder reads both extensions'
 * encodings.
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
