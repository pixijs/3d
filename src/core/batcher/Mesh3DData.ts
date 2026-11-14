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
 * Built the first time the mesh is dirty in a pass. When the mesh is dirty again, its shader is
 * resolved again only if something that picks a shader bit changed since ({@link isStaleFor}), or
 * `Mesh3D.invalidate()` asked for it. So a mesh taken out of the scene and put back keeps its
 * shader. Between rebuilds:
 *
 * - `state` is the source `State` itself, usually `material.state`. Draw commands bind their
 *   pipeline's copy of it (`pipelineState`), so a changed field reaches no draw on either backend
 *   until the mesh is re-keyed, which takes an invalidate, as {@link BaseMaterial3D}'s class notes
 *   say.
 * - `shader` is compiled from the recipe once, so later recipe changes don't reach it.
 * - `topology` is copied when the entry is built.
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
   * The `geometry.uid` this entry was resolved from; -1 marks an entry that must be resolved again
   * ({@link markStale})
   *
   * Uids rather than the objects: a mesh that leaves every pass never reaches the dirty hook again,
   * and holding the geometry would pin it after the user destroyed it.
   */
  public lastGeometryUid = -1;
  /** The `material.uid` this entry was resolved from */
  public lastMaterialUid = -1;
  /** The material's `_descriptorDirtyId` this entry was resolved at */
  public lastDescriptorDirtyId = -1;
  /** The view's `_shaderVersion` this entry was resolved at */
  public lastViewShaderVersion = -1;
  /** The mesh's billboard mode this entry was resolved with */
  public lastBillboardMode: BillboardMode = 'none';
  /** Whether the mesh received shadows when this entry was resolved */
  public lastReceiveShadow = true;

  /**
   * Whether a draw with `shader` binds the mesh's material at group 2, which it does when the
   * shader's bits read the material's fields or textures
   *
   * `compileShader` works it out. Both batchers and the draw list read it here, per mesh, so one
   * pass's list can hold draws that bind a material and draws that don't.
   */
  public bindsMaterial: boolean;

  constructor(shader: Shader, state: State, topology: Topology, bindsMaterial: boolean) {
    this.shader = shader;
    this.state = state;
    this.topology = topology;
    this.bindsMaterial = bindsMaterial;
  }

  /**
   * Whether the item has to resolve this entry's shader again, because something that picks a
   * shader bit changed since {@link claimBuiltFrom}, or the shader went with the renderer that
   * compiled it
   *
   * A shader's bits come from the geometry, the material and its descriptor, the mesh's billboard
   * mode and shadow receiving, and the view's settings and passes. Each is compared here. What the
   * engine can't see change, such as a geometry's attributes edited in place, takes an
   * `invalidate()`, which calls {@link markStale}.
   *
   * Plain compares rather than one packed key: packing costs the same reads, and packing is how
   * identity gets truncated (see `updateMesh3DKeys`).
   * @param item - The item this entry was resolved from
   * @param viewShaderVersion - The `_shaderVersion` of the view the item draws in
   */
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

  /**
   * Records what this entry was just resolved from, for {@link isStaleFor}
   * @param item - The item this entry was just resolved from
   * @param viewShaderVersion - The `_shaderVersion` of the view the item draws in
   */
  public claimBuiltFrom(item: Mesh3DData, viewShaderVersion: number): void {
    const material = item.material;

    this.lastGeometryUid = item.geometry.uid;
    this.lastMaterialUid = material.uid;
    this.lastDescriptorDirtyId = material._descriptorDirtyId;
    this.lastViewShaderVersion = viewShaderVersion;
    this.lastBillboardMode = item.billboardMode;
    this.lastReceiveShadow = item.receiveShadow;
  }

  /** Makes {@link isStaleFor} answer yes until the entry is resolved again; an `invalidate()` calls it */
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

  /**
   * The item's {@link MeshPassCache} per `RenderPassBit`
   *
   * The material system's `ensurePassShader` fills each entry: the material's shader at the
   * material's main pass bit, and a pass's own shader at that pass's bit. A shader of the pass's
   * own wins on the main pass bit too. The batcher does one lookup here per item.
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
