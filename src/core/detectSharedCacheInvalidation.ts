import type { GeometryAtlasPool } from '../geometry/GeometryAtlasPool';
import type { View3DGlobalData } from '../scene/View3DGlobalData';
import type { GeometryDataStoreBuffer } from './buffers/GeometryDataStoreBuffer';
import type { MaterialDataStoreBuffer } from './buffers/MaterialDataStoreBuffer';
import type { MorphStoreBuffer } from './buffers/MorphStoreBuffer';

/**
 * Whether a shared buffer the view's cached draws baked has been reallocated since it last rendered; records the
 * new versions in `data`, so each change reports once
 * @internal
 */
export function detectSharedCacheInvalidation(
  atlases: GeometryAtlasPool,
  materialStore: MaterialDataStoreBuffer,
  data: View3DGlobalData,
  morphStore: MorphStoreBuffer,
  geometryStore?: GeometryDataStoreBuffer,
): boolean {
  let invalidated = false;

  if (data.lastAtlasBufferVersion !== atlases.bufferVersion) {
    data.lastAtlasBufferVersion = atlases.bufferVersion;
    invalidated = true;
  }

  if (data.lastMaterialStoreBufferVersion !== materialStore.bufferVersion) {
    data.lastMaterialStoreBufferVersion = materialStore.bufferVersion;
    invalidated = true;
  }

  if (data.lastMorphStoreBufferVersion !== morphStore.bufferVersion) {
    data.lastMorphStoreBufferVersion = morphStore.bufferVersion;
    invalidated = true;
  }

  if (geometryStore && data.lastGeometryStoreBufferVersion !== geometryStore.bufferVersion) {
    data.lastGeometryStoreBufferVersion = geometryStore.bufferVersion;
    invalidated = true;
  }

  return invalidated;
}
