import type { GltfFormat } from '../GltfFormat';

// oxlint-disable-next-line typescript/consistent-type-imports
type MeshoptDecoder = typeof import('meshoptimizer/decoder').MeshoptDecoder;

let decoderPromise: Promise<MeshoptDecoder> | undefined;

/** Imports `meshoptimizer/decoder` alone, as the package root also bundles the encoder and simplifier */
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
 * Keeps each view's `byteStride`, which interleaved accessors read. `normalizeMeshopt` relies on
 * this deleting each decoded view's extension entry
 * @param gltfRaw - Parsed glTF JSON, rewritten in place
 * @param buffers - By glTF buffer index; decoded views are appended
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
