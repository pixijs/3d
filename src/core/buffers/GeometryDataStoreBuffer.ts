import type { Geometry3D } from '../../geometry/Geometry3D';
import { DataStoreBuffer } from './DataStoreBuffer';

/**
 * Floats per geometry row — must match the WGSL `GeometryData` struct
 * @internal
 */
export const GEOMETRY_DATA_STRIDE = 8;

/**
 * Writes one geometry's row — bounding-sphere texel plus morph-facts texel
 * (see `GeometryDataStoreBuffer` for the layout)
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

  // Morph texel, written only when it means something — non-morphed rows keep
  // their zeroed lanes, and stale values in a recycled row are unreadable:
  // only morph-composed shaders (gated by this same count) read the texel, and
  // the per-instance weight offset gates the loop besides. Mirrors the
  // skeleton lane's conditional write in copyMeshData.
  if (geometry.morphTargetCount > 0) {
    // A morphed survivor of a destroyed renderer can never re-pack (raw targets
    // are released at pack), so the next renderer's morph store resets its base
    // to -1: write a zero count so the morph loop is dead — unmorphed, not
    // reading a wrapped arena offset.
    const packed = geometry._morphDeltaBase >= 0;
    u32Buffer[offset + 4] = packed ? geometry._morphDeltaBase : 0;
    u32Buffer[offset + 5] = packed ? geometry.morphTargetCount : 0;
    u32Buffer[offset + 6] = packed ? geometry._geometryAtlasAllocation?.baseVertex || 0 : 0;
  }
};

/**
 * Per-geometry data store, keyed by a minted `_geometryDataIndex`
 *
 * The per-geometry sidecar every backend reads (WebGPU binds the storage
 * buffer; WebGL binds the data-texture view). Every geometry registers;
 * stride 8, two texels per row:
 *
 *   `[0..3]` — bounding **sphere**: `center.xyz`, `radius`. Copied from
 *   `Geometry3D.boundsSphere` and expanded by `_morphBoundsExpansion` so a
 *   morphing surface can't escape it (valid for weights in [0, 1]). Dynamic
 *   geometry writes `radius = -1`: registered — its morph texel stays live —
 *   but never frustum-culled, since its streamed contents have unknowable
 *   bounds. The sphere is loose-but-always-correct: only false negatives
 *   (draw something off-screen), never false positives. Bounds are in
 *   `bounds3D`'s space; the cull transform reconciles quantization.
 *
 *   `[4..7]` — per-geometry morph facts, as u32: `_morphDeltaBase`,
 *   `morphTargetCount`, atlas `baseVertex` (0 when non-atlased — own-buffer
 *   draws are already vertex-local), and a spare lane. Read by the morph
 *   shader bits through the mesh row's lane-18 index; left unwritten for
 *   non-morphed geometry, and never read there (the morph loop is gated by
 *   the instance's weight offset).
 *
 * Geometries are user-owned and outlive the store (which dies with its
 * renderer), so the store keeps no membership list: each geometry carries the
 * store that minted its row (`_geometryDataStore`); when that is not this
 * store, `set` hands the old row back to it and re-mints here, and calls
 * through a back-reference to a destroyed store are no-ops. One live renderer
 * at a time — two live renderers drawing the same geometry would re-mint it
 * every frame.
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
   * Stamps this store on the geometry so `Geometry3D.destroy` can release its row
   *
   * A row minted by another store (a destroyed renderer's, typically) is never
   * adopted: it is handed back to that store, whose `remove` resets the index
   * so `allocate` mints this store's own row — otherwise the copier writes into
   * a row this store may have given someone else, and the geometry's eventual
   * destroy would free a foreign index into this store's free list (permanent
   * row aliasing).
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
