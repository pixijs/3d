import type { Geometry3D } from '../../geometry/Geometry3D';
import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import { Sphere } from '../../math/shapes/Sphere';
import type { BillboardMode } from '../../scene/Mesh3D';
import { MESH3D_STORE_STRIDE } from '../buffers/Mesh3DDataStoreBuffer';
import type { Mesh3DBatch } from './Mesh3DBatch';
import type { Mesh3DData, MeshPassCache } from './Mesh3DData';

/**
 * One slot of a user `Mesh3DBatch`, the engine side of a {@link BatchedMesh3D} instance
 *
 * It has no scene node or parent: its matrix is written straight into the batch's store.
 * @internal
 */
export class Mesh3DSlot implements Mesh3DData {
  /** The slot's index in its batch, which makes it unique there */
  public uid = 0;
  public _sortKey = 0;
  public _storeIndex = 0;
  public _batchDirty = true;
  public _lastRenderPass = 0;
  /** Slots are never skinned */
  public readonly skeleton = undefined;
  public _passCache: Record<number, MeshPassCache> = Object.create(null);
  /** Geometry drawn for this slot; set through `Mesh3DBatch.setGeometryAt` */
  public geometry!: Geometry3D;
  /** Material for this slot; set through `Mesh3DBatch.setMaterialAt` */
  public material!: BaseMaterial3D;

  /** Whether the slot samples the shadow map */
  public receiveShadow = true;
  /**
   * Billboard the slot in the vertex stage
   *
   * Changing it needs {@link BatchedMesh3D#invalidate}, as every slot-level shader change does.
   */
  public billboardMode: BillboardMode = 'none';
  /** Always 1: hiding a slot is a membership change through `setItemActive` */
  public readonly _worldVisible = 1;

  /** The owning batch whose store holds this slot's matrix `L` for `boundingSphere` */
  private readonly _batch: Mesh3DBatch;
  /** The cached `boundingSphere`, built on first read */
  private _boundingSphere: Sphere | null = null;
  /**
   * The `Mesh3DBatch._matricesId` the cached bounding sphere was built against
   *
   * The sphere is stale whenever the two differ. A whole-batch matrix write bumps the batch id,
   * which marks every slot stale at once; a change to this slot alone (its matrix or its
   * geometry) sets this to `-1`, which no batch id ever equals.
   * @internal
   */
  public _boundsCacheId = -1;

  constructor(uid: number, storeIndex: number, batch: Mesh3DBatch) {
    this.uid = uid;
    this._storeIndex = storeIndex;
    this._batch = batch;
  }

  /**
   * Bounding {@link Sphere} in the batch's local frame
   *
   * The geometry's sphere under the slot's matrix `L`, read straight from the store, without the
   * container's transform: the cull moves the frustum planes into this frame instead, so moving
   * the container restamps nothing. The radius scales by the longest of `L`'s three axes. Rebuilt
   * when the matrix or the geometry changes; dynamic geometry gives an empty sphere. Returns the
   * shared instance, so don't mutate it; `clone()` it for a snapshot.
   */
  public get boundingSphere(): Sphere {
    const batch = this._batch;
    const sphere = (this._boundingSphere ||= new Sphere());
    const matricesId = batch._matricesId;
    if (this._boundsCacheId !== matricesId) {
      this._boundsCacheId = matricesId;
      const geometry = this.geometry;
      if (geometry.dynamic) {
        sphere.makeEmpty();
      } else {
        const f32 = batch.storeBuffer.data;
        const base = this._storeIndex * MESH3D_STORE_STRIDE;
        const { center, radius } = geometry.boundsSphere;
        const cx = center.x;
        const cy = center.y;
        const cz = center.z;
        const l00 = f32[base];
        const l01 = f32[base + 1];
        const l02 = f32[base + 2];
        const l10 = f32[base + 4];
        const l11 = f32[base + 5];
        const l12 = f32[base + 6];
        const l20 = f32[base + 8];
        const l21 = f32[base + 9];
        const l22 = f32[base + 10];
        sphere.center.set(
          l00 * cx + l10 * cy + l20 * cz + f32[base + 12],
          l01 * cx + l11 * cy + l21 * cz + f32[base + 13],
          l02 * cx + l12 * cy + l22 * cz + f32[base + 14],
        );
        const sx = l00 * l00 + l01 * l01 + l02 * l02;
        const sy = l10 * l10 + l11 * l11 + l12 * l12;
        const sz = l20 * l20 + l21 * l21 + l22 * l22;
        sphere.radius = radius * Math.sqrt(Math.max(sx, sy, sz));
      }
    }
    return sphere;
  }

  /**
   * Releases the owning batch reference
   * @internal
   */
  public destroy(): void {
    (this._batch as Mesh3DBatch | null) = null;
  }
}
