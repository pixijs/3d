import type { Geometry3D } from '../../geometry/Geometry3D';
import { DataStoreBuffer } from './DataStoreBuffer';

/**
 * Floats per geometry row; must match the WGSL `GeometryData` struct
 * @internal
 */
export const GEOMETRY_DATA_STRIDE = 8;

/**
 * Writes 0 targets for a geometry whose deltas went with a destroyed renderer, so it draws unmorphed
 * rather than reading a stale offset
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
 * `Geometry3D.destroy` frees a geometry's row through its `_geometryDataStore`
 * @internal
 */
export class GeometryDataStoreBuffer extends DataStoreBuffer<Geometry3D> {
  constructor(initialSize = 100) {
    super({
      stride: GEOMETRY_DATA_STRIDE,
      indexKey: '_geometryDataIndex',
      copier: copyGeometryData,
      initialSize,
    });
  }

  /**
   * Never adopts another store's row, whose index may name a row here, but frees it there and takes a
   * new one, so two live renderers drawing one geometry swap its row every frame
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
