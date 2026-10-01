import type { Shader, State, Topology } from 'pixi.js';

import type { Geometry3D } from '../../geometry/Geometry3D';
import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import type { Sphere } from '../../math/shapes/Sphere';
import type { BillboardMode } from '../../scene/Mesh3D';
import type { Morph } from '../../scene/Morph';
import type { Skeleton } from '../../scene/Skeleton';

/**
 * What one mesh draws with in one pass: its compiled shader, state, topology and batch key
 *
 * The {@link PassDescriptor} a pass or material declares, resolved for the mesh, plus the
 * `batchKey` the batcher compares. The batcher reads it for every mesh it walks. A class, so every
 * entry shares one hidden class and those reads stay monomorphic.
 *
 * Built the first time the mesh is dirty in a pass and rebuilt only when it's dirty again, such as
 * when its geometry or material changes or on `Mesh3D.invalidate()`. Between rebuilds:
 *
 * - `state` is the source `State` itself, usually `material.state`. WebGL draws pick up a changed
 *   field; WebGPU keeps replaying the bundle it recorded, so a change there needs an invalidate, as
 *   {@link BaseMaterial3D}'s class notes say.
 * - `shader` is compiled from the recipe once, so later recipe changes don't reach it.
 * - `topology` is copied when the entry is built.
 * @internal
 */
export class MeshPassCache {
  /** Compiled shader for this pass, from `renderer.material3d.compileShader` */
  public shader: Shader;
  /** The material's pass state, else the pass's, else `material.state` */
  public state: State;
  /** The material's pass topology, else the pass's, else the material's, else the geometry's */
  public topology: Topology;
  /** Exact pipeline+geometry identity, written by `updateMesh3DKeys`; batch breaks compare it */
  public batchKey = 0;

  /**
   * The `geometry.uid` this entry was resolved from, so a pass-descriptor pass can tell a current
   * entry from a stale one ({@link isStaleFor})
   *
   * Uids rather than the objects: a mesh that leaves every pass never reaches the dirty hook again,
   * and holding the geometry would pin it after the user destroyed it. Stays `-1` for the material's
   * own passes, which `ensureMaterial` rebuilds whole.
   */
  public lastGeometryUid = -1;
  /** The `material.uid` this entry was resolved from; see {@link lastGeometryUid} */
  public lastMaterialUid = -1;

  constructor(shader: Shader, state: State, topology: Topology) {
    this.shader = shader;
    this.state = state;
    this.topology = topology;
  }

  /**
   * Whether the item's geometry or material has changed since this entry was resolved, which is
   * when a pass-descriptor pass rebuilds it
   *
   * Two compares rather than one packed key: packing the uids would cost the same two reads, and
   * packing is how identity gets truncated (see `updateMesh3DKeys`).
   * @param item - The item this entry was resolved from
   */
  public isStaleFor(item: Mesh3DData): boolean {
    return this.lastGeometryUid !== item.geometry.uid || this.lastMaterialUid !== item.material.uid;
  }

  /**
   * Records the geometry and material this entry was just resolved from, for {@link isStaleFor}
   * @param item - The item this entry was just resolved from
   */
  public claimBuiltFrom(item: Mesh3DData): void {
    this.lastGeometryUid = item.geometry.uid;
    this.lastMaterialUid = item.material.uid;
  }
}

/**
 * What the renderer needs from anything it draws: a scene {@link Mesh3D} or a `Mesh3DSlot` of a
 * {@link BatchedMesh3D}
 *
 * The batchers, the render passes, the instance buffers and the per-frame scene update all work
 * through it, so they handle both kinds alike.
 * @internal
 */
export interface Mesh3DData {
  /** Unique within its batch; keys the item in sorted views */
  uid: number;

  /**
   * Draw-order key, packed into one exact Float64
   *
   * `updateMesh3DKeys` writes it in the dirty hook and documents the layout. The transparent pass
   * overwrites it every frame with the negated squared distance to the camera.
   */
  _sortKey: number;

  /** Geometry drawn for this item */
  geometry: Geometry3D;
  /** Material supplying the item's shader, state, and textures */
  material: BaseMaterial3D;

  /** The item's row in its batch's `Mesh3DDataStoreBuffer` */
  _storeIndex: number;

  /**
   * Set when the item's geometry, material or the material's shader settings change, so the next
   * frame rebuilds its shader, keys and pass data
   *
   * `updateView3DScene` clears it once the rebuild is done.
   */
  _batchDirty: boolean;

  /** The `RenderPassBit` flags of the passes the item is in, compared with the wanted mask to spot a change */
  _lastRenderPass: number;

  /** Optional skeleton for skinned meshes; affects shader variant selection */
  skeleton?: Skeleton;

  /** Optional morph-target state for morphed meshes; affects shader variant selection */
  morph?: Morph;

  /**
   * The item's {@link MeshPassCache} per `RenderPassBit`
   *
   * `ensureMaterial` fills the entries for the material's own passes, and a pass with its own
   * shader fills its entry in `onRenderableDirty`. The batcher does one lookup here per item.
   */
  _passCache: Record<number, MeshPassCache>;

  /** Whether this item samples the shadow map; controls shader variant selection */
  receiveShadow: boolean;

  /**
   * Whether the vertex stage turns the item to face the camera, and how
   *
   * Picks a shader variant: the material systems add the billboard bit from it, so it works with
   * any material. Never `undefined`, so every implementation keeps one hidden class.
   */
  billboardMode: BillboardMode;

  /**
   * Whether the item is visible, as 0 or 1
   *
   * A scene mesh takes it from {@link Container3D#worldVisible}. A batch slot is always 1, since
   * hiding a slot is a membership change through `setItemActive`. The CPU compaction reads it here,
   * with the item already in hand; the cull kernel reads the copy in the store row's visibility lane.
   */
  readonly _worldVisible: number;

  /**
   * The item's bounding {@link Sphere} in its batch's store frame
   *
   * World space for a scene mesh, whose batch matrix is identity. For a {@link BatchedMesh3D} slot
   * it's the geometry's sphere under the slot's own matrix, without the container's: the cull
   * transforms the six frustum planes into that frame once per batch, so moving the container
   * restamps no spheres. Cached and rebuilt on change. Returns the shared instance, so don't mutate
   * it; `clone()` it for a snapshot.
   */
  readonly boundingSphere: Sphere;
}
