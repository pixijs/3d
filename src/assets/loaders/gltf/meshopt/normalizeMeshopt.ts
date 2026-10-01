import type { GltfFormat } from '../GltfFormat';
import { decodeMeshoptBufferViews } from './decodeMeshoptBufferViews';

/**
 * Turns a glTF that uses meshopt compression into a plain one, in place
 *
 * Every compressed bufferView is decoded into a buffer of its own, and then `buffers` is compacted
 * to the buffers some bufferView still uses. That drops the fallback placeholders and the
 * compressed sources, and leaves a glTF the parser reads as if meshopt were never there.
 *
 * Compaction remaps only `bufferView.buffer`. An extension that pointed at a buffer directly would
 * need remapping too; meshopt is the only one, and its entries are gone by then.
 * @param gltfRaw - Parsed glTF JSON; its bufferViews are rewritten to the decoded, compacted buffers
 * @param buffers - Binary buffers indexed by glTF buffer index; decoded and compacted in place
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
