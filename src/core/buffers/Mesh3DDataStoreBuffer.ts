import type { Geometry3D } from '../../geometry/Geometry3D';
import type { Mesh3D } from '../../scene/Mesh3D';
import { DataStoreBuffer } from './DataStoreBuffer';

/**
 * 32-bit lanes per mesh store row, 24 as WGSL pads `RenderableStruct` to its `mat4x4` alignment. Its
 * fields must stay in lane order, and lanes 16 to 18 in one texel, which `instanceFetchBitGl` fetches once
 * @internal
 */
export const MESH3D_STORE_STRIDE = 24;
/**
 * Written for skinned meshes only, since only skinned shaders read it
 * @internal
 */
export const MESH3D_LANE_BONES = 16;
/** @internal */
export const MESH3D_LANE_MATERIAL = 17;
/**
 * Holds -1 as a `u32`, the cull kernel's `NO_BOUNDS`, until the geometry has a row
 * @internal
 */
export const MESH3D_LANE_GEOMETRY = 18;
/**
 * 0 when hidden; {@link Mesh3DDataStoreBuffer.visible} holds the copy the CPU reads
 * @internal
 */
export const MESH3D_LANE_VISIBILITY = 19;
/**
 * 0 means no weights, since real offsets start past the delta arena; always written, so a reused row
 * never keeps the last owner's offset
 * @internal
 */
export const MESH3D_LANE_MORPH_WEIGHT = 20;

/** @internal */
export const MESH3D_SPHERE_STRIDE = 4;

/** Moves the 16 floats as 8 f64s, which alias them, to halve the copies */
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
  u32Buffer[offset + MESH3D_LANE_GEOMETRY] = renderable.geometry._geometryDataIndex;

  u32Buffer[offset + MESH3D_LANE_MORPH_WEIGHT] = renderable._morph ? renderable._morph._weightIndex : 0;
};

/**
 * Writes radius -1, which the cull always keeps, for dynamic geometry or an empty sphere
 * @internal
 */
export function transformBoundingSphere(
  out: Float32Array,
  o: number,
  matrix: ArrayLike<number>,
  matrixOffset: number,
  geometry: Geometry3D,
  radiusGrowth: number,
): void {
  const local = geometry.boundsSphere;
  const radius = local.radius;

  if (geometry.dynamic || radius < 0) {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    out[o + 3] = -1;

    return;
  }

  const center = local.center;
  const cx = center.x;
  const cy = center.y;
  const cz = center.z;
  const m00 = matrix[matrixOffset];
  const m01 = matrix[matrixOffset + 1];
  const m02 = matrix[matrixOffset + 2];
  const m10 = matrix[matrixOffset + 4];
  const m11 = matrix[matrixOffset + 5];
  const m12 = matrix[matrixOffset + 6];
  const m20 = matrix[matrixOffset + 8];
  const m21 = matrix[matrixOffset + 9];
  const m22 = matrix[matrixOffset + 10];

  out[o] = m00 * cx + m10 * cy + m20 * cz + matrix[matrixOffset + 12];
  out[o + 1] = m01 * cx + m11 * cy + m21 * cz + matrix[matrixOffset + 13];
  out[o + 2] = m02 * cx + m12 * cy + m22 * cz + matrix[matrixOffset + 14];

  const sx = m00 * m00 + m01 * m01 + m02 * m02;
  const sy = m10 * m10 + m11 * m11 + m12 * m12;
  const sz = m20 * m20 + m21 * m21 + m22 * m22;
  out[o + 3] = (radius + radiusGrowth) * Math.sqrt(Math.max(sx, sy, sz));
}

/** @internal */
export class Mesh3DDataStoreBuffer extends DataStoreBuffer<Mesh3D> {
  /**
   * Each row's sphere for the CPU cull, in its matrix's space; `null` until {@link writesSpheres} first
   * turns on, and never uploaded
   */
  public boundingSpheres: Float32Array | null = null;

  /** While off, {@link boundingSpheres} go stale, so the batch sweeps every row when it turns this on */
  public writesSpheres = false;

  /** Each row's visibility lane as a byte, so a CPU walk reads 1 byte a row; write both through `_storeVisibility` */
  public visible: Uint8Array;

  constructor(initialSize = 100) {
    super({
      stride: MESH3D_STORE_STRIDE,
      initialSize,
      indexKey: '_storeIndex',
      copier: copyMeshData,
    });

    this.visible = new Uint8Array(Math.floor(this.data.length / MESH3D_STORE_STRIDE));
  }

  public enableSphereWrites(value: boolean): void {
    this.writesSpheres = value;
    if (value && this.boundingSpheres === null && this.data) {
      this.boundingSpheres = new Float32Array(
        Math.floor(this.data.length / MESH3D_STORE_STRIDE) * MESH3D_SPHERE_STRIDE,
      );
    }
  }

  public override set(item: Mesh3D): number {
    const index = super.set(item);
    if (index >= 0) {
      this._storeVisibility(index, item._worldVisible);
      const geometry = item.geometry;
      this.writeBoundingSphere(
        index,
        this.data,
        index * MESH3D_STORE_STRIDE,
        geometry,
        item._morph ? geometry._morphBoundsExpansion : 0,
      );
    }

    return index;
  }

  public writeBoundingSphere(
    index: number,
    matrix: ArrayLike<number>,
    matrixOffset: number,
    geometry: Geometry3D,
    radiusGrowth: number,
  ): void {
    if (!this.writesSpheres) return;
    transformBoundingSphere(
      this.boundingSpheres!,
      index * MESH3D_SPHERE_STRIDE,
      matrix,
      matrixOffset,
      geometry,
      radiusGrowth,
    );
  }

  /** Called as the transform pass computes the matrix, while it's still in the CPU cache */
  public writeWorldTransform(index: number, elements64: Float64Array): void {
    copyWorldTransform(this.fl64Data, index * (MESH3D_STORE_STRIDE >> 1), elements64);
    this.markDirty(index);
  }

  public writeVisibility(index: number, worldVisible: number): void {
    this._storeVisibility(index, worldVisible);
    this.markDirty(index);
  }

  /** Marks nothing for upload, since the block's allocation already did */
  public writeVisibilityRange(first: number, count: number, worldVisible: number): void {
    for (let i = first, end = first + count; i < end; i++) this._storeVisibility(i, worldVisible);
  }

  private _storeVisibility(index: number, worldVisible: number): void {
    this.u32Data[index * MESH3D_STORE_STRIDE + MESH3D_LANE_VISIBILITY] = worldVisible;
    this.visible[index] = worldVisible;
  }

  public override destroy(): void {
    super.destroy();
    (this.visible as Uint8Array | null) = null;
    this.boundingSpheres = null;
  }

  protected override _expand(minSize?: number): void {
    super._expand(minSize);

    const visible = new Uint8Array(Math.floor(this.data.length / MESH3D_STORE_STRIDE));
    visible.set(this.visible);
    this.visible = visible;
    if (this.boundingSpheres === null) return;

    const spheres = new Float32Array(Math.floor(this.data.length / MESH3D_STORE_STRIDE) * MESH3D_SPHERE_STRIDE);
    spheres.set(this.boundingSpheres);
    this.boundingSpheres = spheres;
  }
}
