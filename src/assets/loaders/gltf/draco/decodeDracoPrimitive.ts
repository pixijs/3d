import type { TypedArray } from 'pixi.js';

import type { Geometry3DOptions } from '../../../../geometry/Geometry3D';
import type { GltfFormat, KHRDracoMeshCompression, MeshPrimitive } from '../GltfFormat';
import { GLTF_SEMANTIC_TO_ATTRIBUTE } from '../utils/gltfAttributeMap';
import { widenColorToRgba } from '../utils/widenColorToRgba';
import type { DracoAttributeRequest } from './worker/loadDracoOnWorker';
import { loadDracoOnWorker } from './worker/loadDracoOnWorker';

/**
 * Decodes a primitive's KHR_draco_mesh_compression extension into `Geometry3DOptions`-shaped data
 *
 * Returns the indices + attributes keyed by internal attribute names like
 * 'positions', 'normals', 'uvs'.
 *
 * Iterates `dracoExt.attributes` (not `primitiveRaw.attributes`) — the Draco
 * extension lists exactly which attributes are compressed, while the primitive
 * may also reference uncompressed accessors which Draco doesn't decode.
 * @param gltfRaw - Parsed glTF JSON, used to resolve the extension's bufferView and accessors
 * @param buffers - Binary buffers indexed by glTF buffer index
 * @param primitiveRaw - The primitive whose attribute accessors the decoded data belongs to
 * @param dracoExt - The primitive's `KHR_draco_mesh_compression` entry
 * @internal
 */
export async function decodeDracoPrimitive(
  gltfRaw: GltfFormat,
  buffers: ArrayBuffer[],
  primitiveRaw: MeshPrimitive,
  dracoExt: KHRDracoMeshCompression,
): Promise<Partial<Geometry3DOptions>> {
  const bufferView = gltfRaw.bufferViews![dracoExt.bufferView];
  const sourceBuffer: ArrayBuffer = buffers[bufferView.buffer];
  const start = bufferView.byteOffset ?? 0;
  // Slice (not view) — the worker takes ownership via transfer, so we must
  // give it a standalone buffer that doesn't alias the shared source.
  const bytes = sourceBuffer.slice(start, start + bufferView.byteLength);

  const attributeIds: Record<string, DracoAttributeRequest> = {};
  const semantics = Object.keys(dracoExt.attributes);
  for (let i = 0; i < semantics.length; i++) {
    const semantic = semantics[i];
    const accessorIdx = primitiveRaw.attributes[semantic];
    if (accessorIdx === undefined) continue;
    const accessor = gltfRaw.accessors![accessorIdx];
    attributeIds[semantic] = {
      dracoId: dracoExt.attributes[semantic],
      componentType: accessor.componentType as number,
    };
  }

  const decoded = await loadDracoOnWorker(bytes, attributeIds);

  const result: Record<string, unknown> = { indices: decoded.indices };
  for (let i = 0; i < semantics.length; i++) {
    const semantic = semantics[i];
    if (!decoded.attributes[semantic]) continue;
    const attributeName = GLTF_SEMANTIC_TO_ATTRIBUTE[semantic];
    if (attributeName) {
      // Colors are VEC3 or VEC4 in glTF; widen so Geometry3D always sees RGBA.
      // Matches the uncompressed path in `processMeshes`.
      const data = decoded.attributes[semantic] as TypedArray;
      result[attributeName] =
        attributeName === 'colors' || attributeName === 'colors1'
          ? widenColorToRgba(data, gltfRaw.accessors![primitiveRaw.attributes[semantic]].type === 'VEC3' ? 3 : 4)
          : data;
    } else {
      // oxlint-disable-next-line no-console
      console.warn(`[gb-model-tools] custom attribute ${semantic} skipped`);
    }
  }

  return result as Partial<Geometry3DOptions>;
}
