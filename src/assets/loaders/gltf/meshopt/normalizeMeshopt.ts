import type { GltfFormat } from '../GltfFormat';
import { decodeMeshoptBufferViews } from './decodeMeshoptBufferViews';

/**
 * Compaction remaps only `bufferView.buffer`. That's enough while meshopt is the only extension that
 * names a buffer, as `decodeMeshoptBufferViews` deletes its entries
 * @param gltfRaw - Parsed glTF JSON, rewritten in place
 * @param buffers - By glTF buffer index; decoded and compacted in place
 * @internal
 */
export async function normalizeMeshopt(gltfRaw: GltfFormat, buffers: ArrayBuffer[]): Promise<void> {
  const usesMeshopt =
    gltfRaw.extensionsUsed?.includes('EXT_meshopt_compression') ||
    gltfRaw.extensionsUsed?.includes('KHR_meshopt_compression');
  if (!usesMeshopt) return;

  await decodeMeshoptBufferViews(gltfRaw, buffers);

  const bufferViews = gltfRaw.bufferViews;
  if (!bufferViews) {
    buffers.length = 0;
    return;
  }

  const remap = new Map<number, number>();
  const compacted: ArrayBuffer[] = [];
  for (let i = 0; i < bufferViews.length; i++) {
    const oldIdx = bufferViews[i].buffer;
    if (!remap.has(oldIdx)) {
      remap.set(oldIdx, compacted.length);
      compacted.push(buffers[oldIdx]);
    }
  }

  for (let i = 0; i < bufferViews.length; i++) {
    bufferViews[i].buffer = remap.get(bufferViews[i].buffer)!;
  }

  buffers.length = 0;
  for (let i = 0; i < compacted.length; i++) buffers.push(compacted[i]);
}
