// Normalizes a raw glTF with EXT/KHR_meshopt_compression into a plain glTF:
// every compressed bufferView is decoded into a fresh buffer, the extension
// entries are deleted, and the buffers array is compacted so fallback stubs
// and now-unreferenced compressed-source buffers drop out. The result is a
// glTF the parser can consume as if meshopt never existed.
//
// Only `bufferView.buffer` indices are remapped during compaction. If a future
// glTF extension ever stores raw bytes in a buffer referenced directly by
// `extension.buffer` (rather than through a bufferView), that extension's
// references would also need remapping here. Today only meshopt does that,
// and its extension entry is deleted by decodeMeshoptBufferViews before
// compaction runs, so there is nothing to track.
import type { GltfFormat } from '../GltfFormat';
import { decodeMeshoptBufferViews } from './decodeMeshoptBufferViews';

/**
 * Decodes any meshopt compression in place and compacts the buffers array
 * @param gltfRaw - Parsed glTF JSON; its bufferViews are rewritten to the decoded, compacted buffers
 * @param buffers - Binary buffers indexed by glTF buffer index; decoded and compacted in place
 * @internal
 */
export async function normalizeMeshopt(gltfRaw: GltfFormat, buffers: ArrayBuffer[]): Promise<void> {
  const usesMeshopt =
    gltfRaw.extensionsUsed?.includes('EXT_meshopt_compression') ||
    gltfRaw.extensionsUsed?.includes('KHR_meshopt_compression');
  if (!usesMeshopt) return;

  // decodeMeshoptBufferViews reads compressed source from `buffers` and
  // appends decoded payloads to the same array in place.
  await decodeMeshoptBufferViews(gltfRaw, buffers);

  const bufferViews = gltfRaw.bufferViews;
  if (!bufferViews) {
    buffers.length = 0;
    return;
  }

  // Collect every buffer index still referenced by a bufferView and build an
  // ascending oldIdx -> newIdx remap. Unreferenced entries (fallback stubs,
  // decoded-away compressed sources) fall out of the final array.
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

  // Replace the caller's array contents in place so upstream keeps a single
  // `buffers` reference through load → normalize → parse.
  buffers.length = 0;
  for (let i = 0; i < compacted.length; i++) buffers.push(compacted[i]);
}
