import type { Shader, State, Topology } from 'pixi.js';

import type { Geometry3D } from '../../geometry/Geometry3D';
import type { BaseMaterial3D } from '../../materials/BaseMaterial3D';
import type { Sphere } from '../../math/shapes/Sphere';
import type { BillboardMode } from '../../scene/Mesh3D';
import type { Morph } from '../../scene/Morph';
import type { Skeleton } from '../../scene/Skeleton';

/**
 * Per-mesh per-pass cache of resolved/computed render data
 *
 * Populated at `onRenderableDirty` time and read on the per-draw hot path.
 *
 * Shape mirrors {@link PassDescriptor} but carries runtime values
 * (compiled `Shader` rather than the `ShaderDescriptor` recipe) plus the
 * pre-hashed `batchKey` used for batch break detection.
 *
 * Implemented as a class — `new` gives V8 a single sealed hidden class for
 * all instances, which makes hot-path field reads (`cache.shader / .state /
 * .batchKey` per draw) measurably faster than equivalent object literals.
 *
 * ## Lifecycle
 *
 * Built once per mesh per pass on the first dirty cycle. Re-runs only when
 * the owning mesh's `_batchDirty` flag fires (set by mesh/material/geometry
 * setters and by `mesh.invalidate()`). Field mutations on the source data
 * after that point do NOT propagate unless they're shared by reference:
 *
 * - `state` is a reference to the source `State` (typically `material.state`
 *   or `pass.descriptor.state`); property mutations on that State propagate
 *   live to the renderer.
 * - `shader` is the compiled Pixi `Shader`, owned by this cache entry. Source
 *   shader-recipe changes don't propagate.
 * - `topology` is captured by value at build time. Source changes don't
 *   propagate.
 *
 * See {@link BaseMaterial3D} class docs for the full invalidation matrix.
 * @internal
 */
export class MeshPassCache {
  /** Compiled shader for this pass (output of `material3d.compileShader`) */
  public shader: Shader;
  /** Resolved render state — `matPd.state || passPd.state || material.state` */
  public state: State;
  /** Resolved primitive topology — `matPd.topology || passPd.topology || material.topology || geometry.topology` */
  public topology: Topology;
  /** Exact pipeline+geometry identity, written by `updateMesh3DKeys`; batch breaks compare it */
  public batchKey: number;

  /**
   * The `geometry.uid` / `material.uid` this entry's shader, state and topology were
   * resolved from, so the pass-descriptor path can tell a reused entry from a stale one
   * ({@link isStaleFor}). Uids rather than references: an inactive mesh never reaches the
   * dirty hook again, and holding the objects would pin a `Geometry3D` the user has
   * already destroyed. Left at `-1` on the primary-material path, which rebuilds the
   * whole entry through `ensureMaterial` instead.
   */
  public lastGeometryUid = -1;
  public lastMaterialUid = -1;

  constructor(shader: Shader, state: State, topology: Topology) {
    this.shader = shader;
    this.state = state;
    this.topology = topology;
    this.batchKey = 0;
  }

  /**
   * Whether the resolved values no longer match the item they came from — the
   * pass-descriptor branch's rebuild condition.
   *
   * Two separate compares rather than one packed key, deliberately. A key would have to
   * be built from these same two reads before it could be compared once, so it is strictly
   * more work for a single equality test; packing uids is also how identity gets truncated,
   * which is the trap `updateMesh3DKeys` carries a warning about. Short-circuits on the
   * first mismatch, and each field says which input moved.
   * @param item - The item this entry was resolved from
   */
  public isStaleFor(item: Mesh3DData): boolean {
    return this.lastGeometryUid !== item.geometry.uid || this.lastMaterialUid !== item.material.uid;
  }

  /**
   * Records the item facts this entry was just resolved from. Pairs with {@link isStaleFor}
   * @param item - The item this entry was just resolved from
   */
  public claimBuiltFrom(item: Mesh3DData): void {
    this.lastGeometryUid = item.geometry.uid;
    this.lastMaterialUid = item.material.uid;
  }
}

/**
 * Minimal rendering contract shared by {@link Mesh3D} (scene graph) and `Mesh3DSlot` (user batches / {@link BatchedMesh3D})
 *
 * Batchers, render passes, ID buffers, and the `View3DPipe` update loop all
 * operate on this interface so they work with both mesh types without caring
 * which concrete class they hold.
 * @internal
 */
export interface Mesh3DData {
  /** Stable unique id — used as the key in sorted views and ID buffers */
  uid: number;

  /**
   * 52-bit sort key packed as a Float64 for radix-friendly sorting
   * Layout (MSB → LSB): textureLayoutId (4 bits) | pipeline (16 bits) |
   * geometry (16 bits) | textureCacheKey (16 bits).
   * Computed by `updateMesh3DKeys` during the dirty hook.
   */
  _sortKey: number;

  /** Geometry drawn for this item */
  geometry: Geometry3D;
  /** Material supplying the item's shader, state, and textures */
  material: BaseMaterial3D;

  /** Index into the `Mesh3DDataStoreBuffer` where this item's per-instance data lives */
  _storeIndex: number;

  /**
   * True when geometry, material, or textures have changed and the item
   * needs shader recreation, sort key recomputation, and render pass hooks.
   * Set by `setGeometryAt` / `setMaterialAt` / texture swap detection.
   * Cleared by `View3DPipe` after processing.
   */
  _batchDirty: boolean;

  /**
   * Bitmask of `RenderPassBit` flags this item currently belongs to
   * Compared against `renderPassMask` to detect membership changes.
   */
  _lastRenderPass: number;

  /** Optional skeleton for skinned meshes; affects shader variant selection */
  skeleton?: Skeleton;

  /** Optional morph-target state for morphed meshes; affects shader variant selection */
  morph?: Morph;

  /**
   * Bundled per-pass cache: shader, state, topology, and batch key, keyed by
   * `RenderPassBit`. Populated by each pass's `onRenderableDirty`. The hot
   * batcher path reads `_passCache[bit].shader / .state / .batchKey` —
   * one sparse-map lookup, three property reads.
   */
  _passCache: Record<number, MeshPassCache>;

  /** Whether this item samples the shadow map; controls shader variant selection */
  receiveShadow: boolean;

  /**
   * Whether the vertex stage rebuilds this item to face the camera, and
   * how. Controls shader variant selection — the material systems inject the
   * billboard bit from it, so it composes with any material.
   *
   * Always present (never `undefined`) so implementers keep one hidden class.
   */
  billboardMode: BillboardMode;

  /**
   * Effective visibility as a 0|1 mask. Scene meshes cascade it from the container tree
   * ({@link Container3D#worldVisible}); user-batch slots are always 1 — per-slot show/hide is a
   * membership change via `setItemActive`. Read by the CPU compaction walks, where the item
   * object is already in hand (the store row's visibility lane is the GPU-side mirror the
   * compute kernel reads).
   */
  readonly _worldVisible: number;

  /**
   * The item's bounding {@link Sphere} in its batch's store frame — world space for scene meshes
   * (identity batch matrix) and batch-local (`L × geometry sphere`) for {@link BatchedMesh3D}
   * instances. Cached and rebuilt lazily on change. The CPU cull reads this and transforms the
   * frustum into the same frame (identity → world planes; a user batch → planes by `Bᵀ`), so a
   * moving batch container re-transforms 6 planes instead of restamping N spheres. Reading it
   * returns the shared cached instance — do not mutate it; `clone()` if you need a snapshot.
   */
  readonly boundingSphere: Sphere;
}
