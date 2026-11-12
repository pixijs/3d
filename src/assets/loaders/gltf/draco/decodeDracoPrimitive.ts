import type { TypedArray } from 'pixi.js';

import type { Geometry3DOptions } from '../../../../geometry/Geometry3D';
import { warnOnce } from '../../../../utils/warnOnce';
import type { GltfFormat } from '../GltfFormat';
import { GLTF_SEMANTIC_TO_ATTRIBUTE } from '../utils/gltfAttributeMap';
import { widenColorToRgba } from '../utils/widenColorToRgba';
import type { DracoAttributeRequest } from './worker/loadDracoOnWorker';
import { loadDracoOnWorker } from './worker/loadDracoOnWorker';

/** @internal */
export async function decodeDracoPrimitive(
  gltfRaw: GltfFormat,
  buffers: ArrayBuffer[],
  primitiveRaw: GltfFormat.MeshPrimitive,
  dracoExt: GltfFormat.KHRDracoMeshCompression,
): Promise<Partial<Geometry3DOptions>> {
  const bufferView = gltfRaw.bufferViews![dracoExt.bufferView];
  const sourceBuffer: ArrayBuffer = buffers[bufferView.buffer];
  const start = bufferView.byteOffset ?? 0;
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
      componentType: accessor.componentType,
    };
  }

  const decoded = await loadDracoOnWorker(bytes, attributeIds);

  const result: Record<string, unknown> = { indices: decoded.indices };
  for (let i = 0; i < semantics.length; i++) {
    const semantic = semantics[i];
    if (!decoded.attributes[semantic]) continue;
    const attributeName = GLTF_SEMANTIC_TO_ATTRIBUTE[semantic];
    if (attributeName) {
      const data = decoded.attributes[semantic] as TypedArray;
      result[attributeName] =
        attributeName === 'colors' || attributeName === 'colors1'
          ? widenColorToRgba(data, gltfRaw.accessors![primitiveRaw.attributes[semantic]].type === 'VEC3' ? 3 : 4)
          : data;
    } else {
      warnOnce(`pixijs-3d-custom-attribute-${semantic}`, `[@pixi/3d] custom attribute ${semantic} skipped`);
    }
  }

  return result;
}
