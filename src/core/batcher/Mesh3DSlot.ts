import type { Geometry3D } from '../../geometry/Geometry3D';
import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import { Sphere } from '../../math/shapes/Sphere';
import type { BillboardMode } from '../../scene/Mesh3D';
import { MESH3D_SPHERE_STRIDE, MESH3D_STORE_STRIDE, transformBoundingSphere } from '../buffers/Mesh3DDataStoreBuffer';
import type { Mesh3DBatch } from './Mesh3DBatch';
import type { Mesh3DData, MeshPassCache } from './Mesh3DData';

const _sphereScratch = new Float32Array(MESH3D_SPHERE_STRIDE);

/** @internal */
export class Mesh3DSlot implements Mesh3DData {
  public uid = 0;
  public _sortKey = 0;
  public _storeIndex = 0;
  public _batchDirty = true;
  public _lastRenderPass = 0;
  public _lastDescriptorDirtyId = -1;
  public readonly skeleton = undefined;
  public _passCache: Record<number, MeshPassCache> = {};
  public geometry!: Geometry3D;
  public material!: BaseMaterial3D;

  public receiveShadow = true;
  public billboardMode: BillboardMode = 'none';
  public _worldVisible = 1;

  private readonly _batch: Mesh3DBatch;
  private _boundingSphere: Sphere | null = null;

  constructor(uid: number, storeIndex: number, batch: Mesh3DBatch) {
    this.uid = uid;
    this._storeIndex = storeIndex;
    this._batch = batch;
  }

  public get boundingSphere(): Sphere {
    const sphere = (this._boundingSphere ||= new Sphere());
    const store = this._batch.storeBuffer;
    let spheres = store.boundingSpheres;
    let o = this._storeIndex * MESH3D_SPHERE_STRIDE;
    if (!store.writesSpheres || spheres === null) {
      const geometry = this.geometry as Geometry3D | undefined;
      if (geometry === undefined) return sphere.makeEmpty();
      spheres = _sphereScratch;
      o = 0;
      transformBoundingSphere(spheres, 0, store.data, this._storeIndex * MESH3D_STORE_STRIDE, geometry, 0);
    }
    sphere.center.set(spheres[o], spheres[o + 1], spheres[o + 2]);
    sphere.radius = spheres[o + 3];

    return sphere;
  }

  public destroy(): void {
    (this._batch as Mesh3DBatch | null) = null;
  }
}
