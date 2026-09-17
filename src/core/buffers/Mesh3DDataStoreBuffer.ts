import type { Mesh3D } from '../../scene/Mesh3D';
import { DataStoreBuffer } from './DataStoreBuffer';

/**
 * Mesh store row stride, in lanes — the row layout's single source of truth
 *
 * Every reader/writer keys off these lane constants: `copyMeshData`, the
 * user-batch field writers (`Mesh3DBatch`), the CPU cull
 * (`produceCpuCompaction`), and the WGSL compact kernel (`ComputeSystemGpu`
 * interpolates these into its shader source).
 *
 * Lanes 0-15 hold the world/local matrix as f32 (written as 8 f64 pairs).
 *
 * Stride is 24 (not 21) because WGSL rounds the struct to 16-byte multiples:
 * 16 matrix floats + 5 u32 lanes pad to 24. Lanes 21-23 are spare. Must equal
 * the WGSL `RenderableStruct` stride.
 * @internal
 */
export const MESH3D_STORE_STRIDE = 24;
/**
 * Bone-pit index of the mesh's skeleton (skinned meshes only)
 * @internal
 */
export const MESH3D_LANE_BONES = 16;
/**
 * Index into the material store buffer
 * @internal
 */
export const MESH3D_LANE_MATERIAL = 17;
/**
 * Geometry bounds-buffer slot (`NO_BOUNDS` sentinel for dynamic/unregistered)
 * @internal
 */
export const MESH3D_LANE_GEOMETRY = 18;
/**
 * Per-instance visibility: 0 = hidden, non-zero = visible. Mirrors `Container3D.worldVisible`
 * @internal
 */
export const MESH3D_LANE_VISIBILITY = 19;
/**
 * Morph: absolute float offset of this instance's weights in the shared morph store
 *
 * `0` = no slot (real offsets start past the delta arena), which gates the
 * shader's morph loop. The per-geometry morph facts (delta base, target
 * count, base vertex) live in the geometry data store, via lane 18. Lanes
 * 21-23 are padding.
 * @internal
 */
export const MESH3D_LANE_MORPH_WEIGHT = 20;

/**
 * Writes a world matrix into the matrix lanes (0-15) of the row starting at `offset64`
 *
 * Moves the 16 floats as 8 f64 stores: `Matrix4.elements64` aliases the f32 storage, so
 * no conversion happens on either side.
 * @param fl64Buffer - Store data, viewed two floats at a time
 * @param offset64 - Row start in f64 units, half the float offset
 * @param elements64 - The world matrix's `elements64` view
 */
const copyWorldTransform = (fl64Buffer: Float64Array, offset64: number, elements64: Float64Array) => {
  fl64Buffer[offset64] = elements64[0];
  fl64Buffer[offset64 + 1] = elements64[1];
  fl64Buffer[offset64 + 2] = elements64[2];
  fl64Buffer[offset64 + 3] = elements64[3];
  fl64Buffer[offset64 + 4] = elements64[4];
  fl64Buffer[offset64 + 5] = elements64[5];
  fl64Buffer[offset64 + 6] = elements64[6];
  fl64Buffer[offset64 + 7] = elements64[7];
};

const copyMeshData = (
  renderable: Mesh3D,
  _buffer: Float32Array,
  u32Buffer: Uint32Array,
  fl64Buffer: Float64Array,
  offset: number,
) => {
  copyWorldTransform(fl64Buffer, offset / 2, renderable.worldTransform.elements64);

  if (renderable.skeleton) {
    u32Buffer[offset + MESH3D_LANE_BONES] = renderable.skeleton._bonePitIndex;
  }

  u32Buffer[offset + MESH3D_LANE_MATERIAL] = renderable.material._materialIndex;
  // Geometry bounds-buffer slot (-1 for dynamic/unregistered) — read by the GPU cull compute.
  u32Buffer[offset + MESH3D_LANE_GEOMETRY] = renderable.geometry._geometryDataIndex;
  // Visibility flag (1 = visible, 0 = hidden) — read at draw-data level (cull compaction /
  // vis-only walk) to skip hidden instances without dropping them from the pass.
  u32Buffer[offset + MESH3D_LANE_VISIBILITY] = renderable._worldVisible;

  // Morph weight offset (lane 20). Written unconditionally: 0 is the natural
  // null (real offsets start past the delta arena), and it's what gates the
  // shader's morph loop — a mesh swapped onto a morphed geometry with no morph
  // state renders base pose instead of reading a recycled row's stale lane.
  u32Buffer[offset + MESH3D_LANE_MORPH_WEIGHT] = renderable.morph ? renderable.morph._weightIndex : 0;
};

/**
 * Per-mesh data store, keyed by `_storeIndex` — one row per renderable
 *
 * Row layout: the world matrix in lanes 0-15 plus the `MESH3D_LANE_*` u32
 * lanes (see `MESH3D_STORE_STRIDE`). The matrix lanes have two writers: the
 * transform pass ({@link Mesh3DDataStoreBuffer.writeWorldTransform}) whenever
 * a mesh moves, and the scene sweep's full-row `set` when a u32 lane changes.
 * @internal
 */
export class Mesh3DDataStoreBuffer extends DataStoreBuffer {
  constructor(initialSize = 100) {
    super({
      stride: MESH3D_STORE_STRIDE,
      initialSize,
      indexKey: '_storeIndex',
      copier: copyMeshData,
    });
  }

  /**
   * Writes just the world-matrix lanes of an allocated row and marks it for upload
   *
   * The transform pass calls this the moment a mesh's world matrix is recomputed,
   * while the matrix is still in cache; re-reading it from the scene sweep later
   * in the frame costs a cold pointer chase per moved mesh. The u32 lanes are
   * untouched.
   * @param index - The mesh's slot (`_storeIndex`); must be allocated.
   * @param elements64 - The world matrix's f64 alias (`Matrix4.elements64`).
   */
  public writeWorldTransform(index: number, elements64: Float64Array): void {
    copyWorldTransform(this.fl64Data, index * (MESH3D_STORE_STRIDE >> 1), elements64);
    this.markDirtyRange(index, index);
  }
}
