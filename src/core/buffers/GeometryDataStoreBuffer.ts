import type { Geometry3D } from '../../geometry/Geometry3D';
import { DataStoreBuffer } from './DataStoreBuffer';

/**
 * Floats per geometry row; must match the WGSL `GeometryData` struct
 * @internal
 */
export const GEOMETRY_DATA_STRIDE = 8;

/**
 * Writes one geometry's row in the layout `GeometryDataStoreBuffer` describes
 *
 * The morph texel is written only for a geometry with morph targets. One whose packed deltas went
 * with a destroyed renderer can't pack again, since its raw targets were released at the first
 * pack, so it gets a target count of 0: the morph loop never runs and the geometry draws unmorphed
 * instead of reading a stale arena offset.
 * @param geometry - Source of the bounding sphere and morph facts
 * @param buffer - Store data as floats; receives the bounding-sphere texel
 * @param u32Buffer - The same store data as u32; receives the morph-facts texel
 * @param _fl64Buffer - The same store data as f64; unused here
 * @param offset - Float offset of the geometry's row
 */
const copyGeometryData = (
  geometry: Geometry3D,
  buffer: Float32Array,
  u32Buffer: Uint32Array,
  _fl64Buffer: Float64Array,
  offset: number,
) => {
  const { center, radius } = geometry.boundsSphere;

  buffer[offset] = center.x;
  buffer[offset + 1] = center.y;
  buffer[offset + 2] = center.z;
  buffer[offset + 3] = geometry.dynamic ? -1 : radius + geometry._morphBoundsExpansion;

  if (geometry.morphTargetCount > 0) {
    const packed = geometry._morphDeltaBase >= 0;
    u32Buffer[offset + 4] = packed ? geometry._morphDeltaBase : 0;
    u32Buffer[offset + 5] = packed ? geometry.morphTargetCount : 0;
    u32Buffer[offset + 6] = packed ? geometry._geometryAtlasAllocation?.baseVertex || 0 : 0;
  }
};

/**
 * One row per geometry, which every backend reads: WebGPU through the storage buffer, WebGL
 * through the data texture
 *
 * Every geometry a mesh draws gets a row, and its index is `_geometryDataIndex`, which the mesh's
 * store row carries in its geometry lane. A row is two texels:
 *
 * - `[0..3]`, floats: the bounding sphere's `center.xyz` and `radius`, from
 *   `Geometry3D.boundsSphere`. The radius grows by `_morphBoundsExpansion`, so a morphing surface
 *   stays inside it for weights in [0, 1]. Dynamic geometry writes a radius of -1: it is never
 *   frustum-culled, since its contents can change at any time, but its morph texel still works.
 *   The sphere can be loose, never too small, so culling only ever draws something off-screen.
 * - `[4..7]`, `u32`s: the morph facts. `_morphDeltaBase`, `morphTargetCount`, the atlas
 *   `baseVertex` (0 outside the atlas, where vertex ids already start at the geometry's own 0),
 *   and a spare lane. Only shaders built with morph targets read it, so it's left unwritten for
 *   other geometry, as the mesh store does with the bone lane.
 *
 * Geometries belong to the user and outlive the store, which dies with its renderer, so the store
 * keeps no list of them. Each geometry carries the store that gave it its row,
 * `_geometryDataStore`. When another store sees it, `set` hands the old row back and gives it a
 * new one, and calls to a destroyed store do nothing. Only one renderer may draw a geometry at a
 * time: two live renderers would swap its row every frame.
 * @internal
 */
export class GeometryDataStoreBuffer extends DataStoreBuffer {
  constructor(initialSize = 100) {
    super({
      stride: GEOMETRY_DATA_STRIDE,
      indexKey: '_geometryDataIndex',
      copier: copyGeometryData,
      initialSize,
    });
  }

  /**
   * Writes the geometry's row, and records this store on it so `Geometry3D.destroy` can free the row
   *
   * A row from another store, usually a destroyed renderer's, is never adopted. Its index may name
   * a row this store gave to another geometry, and freeing it later would put a foreign index on
   * this store's free list, so two geometries would share a row for good. The row goes back to the
   * old store instead, whose `remove` resets the index, and the geometry gets a new row here.
   * @param geometry - The geometry whose row is written; re-minted here when another store owns it
   */
  public override set(geometry: Geometry3D): number {
    const old = geometry._geometryDataStore;
    if (old !== this) {
      old?.remove(geometry);
      geometry._geometryDataStore = this;
    }
    return super.set(geometry);
  }
}
