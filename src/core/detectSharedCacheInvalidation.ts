import type { GeometryAtlasPool } from '../geometry/GeometryAtlasPool';
import type { View3DGlobalData } from '../scene/View3DGlobalData';
import type { GeometryDataStoreBuffer } from './buffers/GeometryDataStoreBuffer';
import type { MaterialDataStoreBuffer } from './buffers/MaterialDataStoreBuffer';
import type { MorphStoreBuffer } from './buffers/MorphStoreBuffer';

/**
 * Whether a shared GPU buffer the View3D's cached draw state was built against
 * has been reallocated since the View last rendered
 *
 * Covers the geometry atlas, the material store, the morph store, and the
 * geometry data store; a reallocation leaves the View's cached VAOs (WebGL) or
 * render bundles (WebGPU) stale. Compares against the last-seen versions on
 * the renderer's global data for the View, updates them in place and returns
 * true on change; the caller then invalidates the affected per-batch draw
 * caches.
 * @param atlases - The renderer's shared geometry atlas pool.
 * @param materialStore - The pipe's material store.
 * @param data - The renderer's global data on the view, holding the last-seen versions; updated in place.
 * @param morphStore - The shared morph store.
 * @param geometryStore - The shared geometry data store (WebGPU only; GL re-binds its texture per frame).
 * @returns True when any version moved.
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
