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

  constructor(shader: Shader, state: State, topology: Topology) {
    this.shader = shader;
    this.state = state;
    this.topology = topology;
  }

  /**
   * Whether a pass with a shader of its own has to resolve the entry again; the uids are compared
   * apart, since packing them would truncate one
   */
  public isStaleFor(item: Mesh3DData): boolean {
    return (
      this.shader._destroyed || this.lastGeometryUid !== item.geometry.uid || this.lastMaterialUid !== item.material.uid
    );
  }

  public claimBuiltFrom(item: Mesh3DData): void {
    this.lastGeometryUid = item.geometry.uid;
    this.lastMaterialUid = item.material.uid;
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

  /**
   * The item's pass-cache entry per `RenderPassBit`; on a material's own pass bit `ensureMaterial`
   * writes first, so a pass's own shader wins
   */
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
