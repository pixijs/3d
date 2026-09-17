import type { Geometry3D } from '../../geometry/Geometry3D';
import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import { Sphere } from '../../math/shapes/Sphere';
import type { BillboardMode } from '../../scene/Mesh3D';
import { MESH3D_STORE_STRIDE } from '../buffers/Mesh3DDataStoreBuffer';
import type { Mesh3DDataStoreBuffer } from '../buffers/Mesh3DDataStoreBuffer';
import type { Mesh3DData, MeshPassCache } from './Mesh3DData';

/**
 * Lightweight item for user-created `Mesh3DBatch` slots
 *
 * No scene graph, no transform hierarchy — set the matrix directly.
 * @internal
 */
export class Mesh3DSlot implements Mesh3DData {
  /** Stable unique id within the owning batch */
  public uid: number;
  public _sortKey = 0;
  public _storeIndex: number;
  public _batchDirty = true;
  public _lastRenderPass = 0;
  /** Slots are never skinned */
  public readonly skeleton = undefined;
  public _passCache: Record<number, MeshPassCache> = Object.create(null);
  /** Geometry drawn for this slot; assigned via `Mesh3DBatch.setGeometryAt` */
  public geometry!: Geometry3D;
  /** Material for this slot; assigned via `Mesh3DBatch.setMaterialAt` */
  public material!: BaseMaterial3D;

  /** Whether the slot samples the shadow map */
  public receiveShadow = true;
  /**
   * Billboard the slot in the vertex stage
   *
   * Declared here (not left `undefined`) so slots keep one hidden class. Changing it needs
   * {@link BatchedMesh3D#invalidate}, as every slot-level shader change does.
   */
  public billboardMode: BillboardMode = 'none';
  /** Slots are always visible — per-slot show/hide is a membership change via `setItemActive` */
  public readonly _worldVisible = 1;

  /** The store this slot's matrix `L` lives in — read by `boundingSphere` */
  private readonly _store: Mesh3DDataStoreBuffer;
  /** Cached batch-local bounding sphere (`L × geometry sphere`); lazily built, CPU culling only */
  private _boundingSphere: Sphere | null = null;
  /**
   * True when the cached bounding sphere is stale — set on a matrix or geometry change
   * @internal
   */
  public _boundsCacheDirty = true;

  constructor(uid: number, storeIndex: number, store: Mesh3DDataStoreBuffer) {
    this.uid = uid;
    this._storeIndex = storeIndex;
    this._store = store;
  }

  /**
   * Bounding {@link Sphere} in the batch's local frame
   *
   * The geometry's local sphere transformed by this instance's store matrix
   * `L`, i.e. **excluding** the batch/container transform (the cull folds that
   * into the frustum planes instead, so a container move doesn't restamp
   * this). Cached; rebuilt when the matrix or geometry changes. Dynamic
   * geometry yields an empty sphere. Returns the shared cached instance — do
   * not mutate it; `clone()` if you need a snapshot.
   */
  public get boundingSphere(): Sphere {
    const sphere = (this._boundingSphere ||= new Sphere());
    if (this._boundsCacheDirty) {
      this._boundsCacheDirty = false;
      const geometry = this.geometry;
      if (geometry.dynamic) {
        sphere.makeEmpty();
      } else {
        // L × geometry sphere, read straight from the store (column-major).
        const f32 = this._store.data;
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
}
