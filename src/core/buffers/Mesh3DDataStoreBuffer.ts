import type { Mesh3D } from '../../scene/Mesh3D';
import { DataStoreBuffer } from './DataStoreBuffer';

/**
 * 32-bit lanes per mesh store row
 *
 * Lanes 0 to 15 hold the mesh's matrix as floats, world space for a scene mesh and batch-local for
 * a batch slot. The `MESH3D_LANE_*` constants name lanes 16 to 20, and 21 to 23 are padding. The
 * CPU writers and the cull, the WGSL cull kernel and the GLSL instance fetch all read the layout
 * from these constants. The WGSL `RenderableStruct` doesn't: its fields must stay in lane order.
 * Lanes 16 to 18 must also stay in one texel, since `instanceFetchBitGl` reads the bone, material
 * and geometry lanes with a single fetch.
 *
 * It's 24 rather than 21 because WGSL rounds a struct's size up to its alignment, 16 bytes for a
 * `mat4x4<f32>`, so 16 matrix floats and 5 `u32`s take 96 bytes.
 * @internal
 */
export const MESH3D_STORE_STRIDE = 24;
/**
 * Lane of the skeleton's first bone in the bone pit; written for skinned meshes only, and only
 * skinned shaders read it
 * @internal
 */
export const MESH3D_LANE_BONES = 16;
/**
 * Lane of the material's row in the material store
 * @internal
 */
export const MESH3D_LANE_MATERIAL = 17;
/**
 * Lane of the geometry's row in the geometry data store
 *
 * Holds -1 as a `u32`, which the cull kernel calls `NO_BOUNDS`, until the geometry has a row.
 * @internal
 */
export const MESH3D_LANE_GEOMETRY = 18;
/**
 * Lane of the mesh's visibility, 0 when hidden, copied from `Container3D.worldVisible`
 *
 * The draw-data compaction reads it to skip a hidden mesh without taking it out of the pass.
 * @internal
 */
export const MESH3D_LANE_VISIBILITY = 19;
/**
 * Lane of the float offset of the mesh's morph weights in the shared morph store
 *
 * 0 means no weights, since real offsets start past the delta arena, and skips the shader's morph
 * loop. The geometry's morph facts are in its geometry row, through lane 18.
 * @internal
 */
export const MESH3D_LANE_MORPH_WEIGHT = 20;

/**
 * Writes a world matrix into lanes 0 to 15 of the row starting at `offset64`
 *
 * Moves the 16 floats as 8 f64 copies: `Matrix4.elements64` views the same memory as the floats,
 * so nothing is converted on either side.
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

/**
 * Writes a scene mesh's whole row
 *
 * The bone lane is written only for a skinned mesh, since only skinned shaders read it. The morph
 * lane is always written, 0 without morph state, so a mesh moved onto a morphed geometry without
 * weights draws its base pose instead of reading the last owner's offset from a reused row.
 * @param renderable - The mesh
 * @param _buffer - The store as floats; unused, the matrix goes through `fl64Buffer`
 * @param u32Buffer - The store as `u32`s, for the index lanes
 * @param fl64Buffer - The store as f64s, for the matrix
 * @param offset - Float offset of the mesh's row
 */
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
  u32Buffer[offset + MESH3D_LANE_GEOMETRY] = renderable.geometry._geometryDataIndex;
  u32Buffer[offset + MESH3D_LANE_VISIBILITY] = renderable._worldVisible;

  u32Buffer[offset + MESH3D_LANE_MORPH_WEIGHT] = renderable.morph ? renderable.morph._weightIndex : 0;
};

/**
 * A batch's mesh store, one row per mesh at its `_storeIndex`, laid out as `MESH3D_STORE_STRIDE`
 * describes
 *
 * A scene mesh's matrix lanes have two writers: the transform pass, through
 * {@link Mesh3DDataStoreBuffer.writeWorldTransform}, whenever the mesh moves, and the per-frame
 * scene update, which rewrites the whole row with `set` when one of its other lanes changes.
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
   * Writes only the matrix lanes of a mesh's row and marks the row for upload
   *
   * The transform pass calls it the moment it recomputes a mesh's world matrix, while the matrix is
   * still in the CPU cache. Reading it again in the scene update later in the frame would cost a
   * cache miss per moved mesh.
   * @param index - The mesh's slot (`_storeIndex`); must be allocated.
   * @param elements64 - The world matrix's f64 alias (`Matrix4.elements64`).
   */
  public writeWorldTransform(index: number, elements64: Float64Array): void {
    copyWorldTransform(this.fl64Data, index * (MESH3D_STORE_STRIDE >> 1), elements64);
    this.markDirtyRange(index, index);
  }
}
