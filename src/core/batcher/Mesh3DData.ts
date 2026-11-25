import type { Shader, State, Topology } from 'pixi.js';

import type { Geometry3D } from '../../geometry/Geometry3D';
import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import type { Sphere } from '../../math/shapes/Sphere';
import type { BillboardMode } from '../../scene/Mesh3D';
import type { Morph } from '../../scene/Morph';
import type { Skeleton } from '../../scene/Skeleton';

/**
 * What one mesh draws with in one pass; a class, so the batcher's reads of every entry stay monomorphic
 * @internal
 */
export class MeshPassCache {
  public shader: Shader;
  /** WebGPU only: the merged-run form of `shader`, `null` until a run merges and whenever `shader` is rebuilt */
  public mergedShader: Shader | null = null;
  public state: State;
  public topology: Topology;
  public batchKey = 0;
  /**
   * The geometry uid the entry was resolved from, or -1 to resolve it again; a uid, so the entry never
   * pins a destroyed geometry
   */
  public lastGeometryUid = -1;
  public lastMaterialUid = -1;
  public lastDescriptorDirtyId = -1;
  public lastViewShaderVersion = -1;
  public lastBillboardMode: BillboardMode = 'none';
  public lastReceiveShadow = true;

  /** Per mesh, since one pass's list can hold draws that bind a material and draws that don't */
  public bindsMaterial: boolean;

  constructor(shader: Shader, state: State, topology: Topology, bindsMaterial: boolean) {
    this.shader = shader;
    this.state = state;
    this.topology = topology;
    this.bindsMaterial = bindsMaterial;
  }

  /** Whether the entry must resolve its shader again; the inputs are compared apart, since packing them would truncate one */
  public isStaleFor(item: Mesh3DData, viewShaderVersion: number): boolean {
    const material = item.material;

    return (
      this.lastGeometryUid !== item.geometry.uid ||
      this.lastMaterialUid !== material.uid ||
      this.lastDescriptorDirtyId !== material._descriptorDirtyId ||
      this.lastViewShaderVersion !== viewShaderVersion ||
      this.lastBillboardMode !== item.billboardMode ||
      this.lastReceiveShadow !== item.receiveShadow ||
      this.shader._destroyed
    );
  }

  public claimBuiltFrom(item: Mesh3DData, viewShaderVersion: number): void {
    const material = item.material;

    this.lastGeometryUid = item.geometry.uid;
    this.lastMaterialUid = material.uid;
    this.lastDescriptorDirtyId = material._descriptorDirtyId;
    this.lastViewShaderVersion = viewShaderVersion;
    this.lastBillboardMode = item.billboardMode;
    this.lastReceiveShadow = item.receiveShadow;
  }

  public markStale(): void {
    this.lastGeometryUid = -1;
  }
}

/**
 * Anything the renderer draws: a scene {@link Mesh3D}, or a slot of a {@link BatchedMesh3D}
 * @internal
 */
export interface Mesh3DData {
  /** The item's id, unique within its batch; sorted views key items by it */
  uid: number;

  /**
   * The draw-order key `updateMesh3DKeys` writes; the transparent pass overwrites it each frame with
   * the negated squared distance to the camera
   */
  _sortKey: number;

  geometry: Geometry3D;
  material: BaseMaterial3D;

  /** The item's row in its batch's store, or -1 while it has none */
  _storeIndex: number;

  /** Whether the item's shader, keys and pass data wait for a rebuild; a slot with it set is queued */
  _batchDirty: boolean;

  /** `RenderPassBit` flags of the passes the item is in */
  _lastRenderPass: number;

  /**
   * The material's `_descriptorDirtyId` at the last rebuild; -1 marks a new material, which the draw
   * lists take as an edit rather than a rebuild
   */
  _lastDescriptorDirtyId: number;

  skeleton?: Skeleton;
  _morph?: Morph;

  /** The item's pass-cache entry per `RenderPassBit`, which `ensurePassShader` writes; on the material's main pass bit a pass's own shader wins */
  _passCache: Record<number, MeshPassCache>;

  receiveShadow: boolean;

  /** How the item turns to face the camera; never `undefined`, so every implementation keeps one hidden class */
  billboardMode: BillboardMode;

  /** Whether the item is visible, as 0 or 1; a hidden item stays in its draw lists */
  readonly _worldVisible: number;

  /**
   * The item's bounding sphere: world space for a scene mesh, relative to the {@link BatchedMesh3D} for a slot
   *
   * Dynamic geometry gives an empty sphere (`radius < 0`). The sphere is shared: `clone()` it to keep
   * a copy.
   */
  readonly boundingSphere: Sphere;
}
