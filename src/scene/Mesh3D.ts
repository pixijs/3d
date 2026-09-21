import { definedProps } from 'pixi.js';

import type { Mesh3DData, MeshPassCache } from '../core/batcher/Mesh3DData';
import { RenderPassBit } from '../core/render-passes/RenderPass';
import type { HitVolume3D } from '../events/HitResult3D';
import { resolveHitVolume } from '../events/resolveHitVolume';
import type { Geometry3D } from '../geometry/Geometry3D';
import type { BaseMaterial3D } from '../materials/BaseMaterial3D';
import { Sphere } from '../math/shapes/Sphere';
import type { Destroy3DOptions } from '../utils/Destroy3DOptions';
import { resolveDestroy3DFlag } from '../utils/Destroy3DOptions';
import type { Container3DOptions } from './Container3D';
import { Container3D } from './Container3D';
import { Morph } from './Morph';
import type { Skeleton } from './Skeleton';

/**
 * Scratch for {@link Mesh3D.boundingSphere}'s morph-expanded path: the local sphere plus the
 * conservative morph reach, transformed as one
 */
const _morphExpandedSphere = new Sphere();

/**
 * How a mesh is oriented by the billboard vertex transform
 *
 * - `'none'` — no billboarding; the mesh draws in its own orientation. The default.
 * - `'spherical'` — always faces the camera, in every axis. Glows, impact
 *   flashes, icons, distance markers.
 * - `'cylindrical'` — yaws toward the camera but never pitches, so the mesh
 *   stays planted. Trees, grass, crowd cutouts, and billboard LOD impostors.
 *
 * Applies the transform in the vertex shader from the mesh's own state, so it
 * composes with any material — a lit PBR impostor works the same as an unlit
 * card — and with any geometry, flat or solid. See {@link Mesh3D#billboardMode}.
 * @category scene
 * @standard
 */
export type BillboardMode = 'none' | 'spherical' | 'cylindrical';

/**
 * Constructor options for {@link Mesh3D}
 *
 * `geometry` and `material` are required; everything else has a sensible default documented on
 * its member. Every {@link Container3DOptions} member (label, position, parent, ...) is accepted
 * too; `label` defaults to `'Mesh3D'`.
 * @example
 * ```ts
 * const mesh = new Mesh3D({
 *   geometry,
 *   material,
 *   castShadow: true,
 *   receiveShadow: true,
 *   position: { x: 0, y: 1, z: 0 },
 *   parent: view.root,
 * });
 * ```
 * @see {@link Mesh3D} For the constructed scene node and runtime accessors.
 * @category scene
 * @standard
 */
export interface Mesh3DOptions extends Container3DOptions {
  /** Vertex/index data drawn by this mesh; required */
  geometry: Geometry3D;
  /** Material applied to {@link Mesh3DOptions.geometry | geometry}; required */
  material: BaseMaterial3D;
  /**
   * Skeleton driving per-vertex skinning
   *
   * Omit for static meshes; supply for skinned meshes whose geometry has `JOINTS_0` /
   * `WEIGHTS_0` attributes.
   */
  skeleton?: Skeleton;
  /**
   * Whether this mesh casts shadows
   *
   * Records user intent — translucent (`alphaMode === 'blend'`) and transmissive materials are
   * excluded from the shadow pass even when this is `true`.
   * @default true
   */
  castShadow?: boolean;
  /**
   * Whether this mesh samples the shadow map
   *
   * Lit shaders omit the shadow lookup when this is `false`. When it is `true`, the view still
   * omits the lookup until a rendered light first casts a shadow. The view keeps shadow sampling
   * enabled after that.
   * @default true
   */
  receiveShadow?: boolean;
  /**
   * Per-instance morph-target weights, one per target on `geometry`
   *
   * Mutated in place by the animation system; defaults to a zero-filled array sized to the
   * geometry's morph-target count when the geometry has morph targets.
   */
  weights?: Float32Array;
  /**
   * Orients the mesh toward the camera in the vertex shader. See
   * {@link Mesh3D#billboardMode}.
   * @default 'none'
   */
  billboardMode?: BillboardMode;
}

/**
 * `Mesh3D` is a single drawable in the 3D scene graph — a {@link Container3D} bound to a
 * {@link Geometry3D} and a {@link BaseMaterial3D}
 *
 * The {@link View3D} indexes every Mesh3D under its `root` and dispatches it across the
 * configured render passes (opaque, transparent, shadow, etc.) based on its material and
 * per-mesh flags.
 *
 * Skinned meshes carry a {@link Skeleton}; the View hosts the skinning pass that resolves bone
 * matrices into the shared bone arena every frame. For high-instance-count scenes prefer
 * {@link BatchedMesh3D}, which collapses many slots into a single batch.
 * @example
 * ```ts
 * import { Mesh3D, Material3D } from '@pixi/3d';
 *
 * const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xff8844 }) });
 * mesh.position.set(0, 1, 0);
 * view.root.addChild(mesh);
 *
 * // Skinned mesh:
 * const skinned = new Mesh3D({ geometry: skinnedGeometry, material, skeleton });
 *
 * // Toggle shadow casting at runtime:
 * mesh.castShadow = false;
 * ```
 * @see {@link Mesh3DOptions} For the constructor options.
 * @see {@link Container3D} For the scene-graph base class.
 * @see {@link BaseMaterial3D} For the material base class and pass authoring.
 * @see {@link Geometry3D} For vertex/index data construction.
 * @see {@link Skeleton} For skinned-mesh bone hierarchies.
 * @see {@link View3D} For the scene root that indexes meshes.
 * @see {@link BatchedMesh3D} For the high-instance-count counterpart.
 * @category scene
 * @standard
 */
export class Mesh3D extends Container3D implements Mesh3DData {
  /**
   * Default {@link Mesh3DOptions} merged under every constructor call
   *
   * `new Mesh3D(opts)` resolves as `{ ...Mesh3D.defaultOptions, ...opts }`. Mutate to change the
   * defaults process-wide.
   *
   * `geometry`, `material`, and `skeleton` have no meaningful defaults and are intentionally
   * absent here.
   * @example
   * ```ts
   * Mesh3D.defaultOptions.castShadow = false;
   * const mesh = new Mesh3D({ geometry, material }); // picks up the override above
   * ```
   */
  public static defaultOptions: Partial<Mesh3DOptions> = {
    castShadow: true,
    receiveShadow: true,
    billboardMode: 'none',
  };

  private _geometry: Geometry3D;
  private _material: BaseMaterial3D;
  private _billboardMode: BillboardMode;

  /**
   * Cached world-space bounding sphere. Allocated lazily on the first
   * {@link Mesh3D.boundingSphere} call — only meshes actually reached by CPU culling ever
   * build one — and rebuilt when the transform or geometry changes.
   */
  private _worldBoundsSphere: Sphere | null = null;
  /**
   * `Container3D._worldTransformId` snapshot the cached `_worldBoundsSphere` was built against
   * Set to `-1` to force a rebuild (initial state, and whenever the geometry — hence the local sphere
   * — is swapped, since that doesn't move the transform).
   */
  private _worldBoundsCacheId = -1;
  /**
   * User intent for shadow casting. The actual SHADOW bit in `renderPassBits` is
   * gated by {@link Mesh3D.updateShadow} so translucent / transmissive materials don't cast
   * shadows even when this is `true`.
   */
  private _castShadowIntent: boolean;

  /**
   * Skeleton driving per-vertex skinning; `undefined` for static meshes
   *
   * Set at construction and treated as immutable for the mesh's lifetime — to swap the
   * skeleton, build a new Mesh3D.
   */
  public readonly skeleton?: Skeleton;

  /**
   * Whether this mesh samples the shadow map
   *
   * Lit shaders omit the shadow lookup when this is `false`. After changing this field at runtime,
   * call {@link Mesh3D.invalidate} so the mesh rebuilds its shader variant on the next frame.
   */
  public receiveShadow: boolean;

  /**
   * Morph-target state — blend weights plus the mesh's slot in the shared morph store
   *
   * Created only when the geometry has morph targets, so presence is the "is morphed" check
   * (as {@link Mesh3D.skeleton} is for skinning).
   */
  public readonly morph?: Morph;

  /**
   * Cached mesh pass bits (SHADOW + any custom passes)
   *
   * OR'd with the material's `_passBit` to produce {@link Mesh3D.renderPassMask}.
   * @internal
   */
  public renderPassBits = 0;

  /**
   * Per-pass bundled cache: shader, state, topology, batchKey
   * @internal
   */
  public _passCache: Record<number, MeshPassCache> = Object.create(null);

  /**
   * Index of this mesh in the View's scene-batch store buffer. `-1` when detached
   * @internal
   */
  public _storeIndex = -1;

  /**
   * Bone-pit base this mesh's store row was last written with; -1 when it has never held one
   *
   * Watermarked per mesh rather than per skeleton because one skeleton can dress several
   * meshes, and the pit dedupes the second and later adds.
   * @internal
   */
  public _lastBonePitIndex = -1;

  /**
   * Packed integer sort key (e.g. material id + depth) used by render-pass sorting
   * @internal
   */
  public _sortKey = 0;

  /**
   * Whether the mesh's per-pass cache is stale and needs rebuilding
   * @internal
   */
  public _batchDirty = true;

  /**
   * The render pass this mesh was last dispatched into; used to detect pass changes
   * @internal
   */
  public _lastRenderPass = 0;

  /**
   * Last `material._descriptorDirtyId` this mesh rebuilt against; used to
   * detect shader-variant and pass-routing changes. `-1` so the first frame always
   * mismatches and rebuilds.
   * @internal
   */
  public _lastDescriptorDirtyId = -1;

  /**
   * Last {@link Container3D.worldVisible} value the render side saw (see
   * `updateView3DScene`). A flip re-emits the store row (whose visibility lane mirrors
   * `worldVisible`) and bumps the batch's visibility dirty-id, so hide/show lands at
   * draw-data level with no membership change — hence no draw-command / bundle rebuild.
   * @internal
   */
  public _lastWorldVisible = 1;

  /**
   * Index in `View3D._skinnedMeshes`; `-1` when not skinned or detached
   * @internal
   */
  public _skinnedMeshIndex = -1;

  /**
   * Index in `View3D._morphedMeshes`; `-1` when not morphed or detached
   * @internal
   */
  public _morphedMeshIndex = -1;

  /**
   * Index in {@link View3D.meshes}; `-1` when detached
   * @internal
   */
  public _allMeshIndex = -1;

  /**
   * Creates a new `Mesh3D`
   *
   * Parent the returned instance under a {@link View3D}'s {@link View3D.root | root} (or any
   * descendant) to render it.
   * @example
   * ```ts
   * const mesh = new Mesh3D({ geometry, material });
   * view.root.addChild(mesh);
   * ```
   * @param options - Construction options; see {@link Mesh3DOptions}.
   */
  constructor(options: Mesh3DOptions) {
    // Own keys are pulled out so the base assignment loop never touches them — `geometry` /
    // `material` have setters over uninitialized privates and `weights` needs the morph state.
    // Held back until the mesh is built: `hitVolume` shorthands and `width` / `height` / `depth`
    // measure `geometry`, and attaching to a live `parent` registers the skeleton and morph.
    const {
      geometry,
      material,
      skeleton,
      castShadow,
      receiveShadow,
      billboardMode,
      weights,
      hitVolume,
      width,
      height,
      depth,
      parent,
      ...rest
    } = {
      ...Mesh3D.defaultOptions,
      ...definedProps(options),
    };

    super({ label: 'Mesh3D', ...rest });

    this._geometry = geometry;
    this._material = material;
    this.skeleton = skeleton;
    this._castShadowIntent = castShadow!;
    this.receiveShadow = receiveShadow!;
    this._billboardMode = billboardMode!;
    if (this._geometry.morphTargetCount > 0) {
      this.morph = new Morph(weights ?? new Float32Array(this._geometry.morphTargetCount));
    }
    this.updateShadow();
    if (hitVolume !== undefined) this.hitVolume = hitVolume;
    if (width !== undefined) this.width = width;
    if (height !== undefined) this.height = height;
    if (depth !== undefined) this.depth = depth;
    parent?.addChild(this);
  }

  /**
   * Per-instance morph-target weights (`undefined` when the geometry has no morph targets)
   *
   * A view over {@link Mesh3D.morph} — the animation system binds and writes this array in place.
   */
  get weights(): Float32Array | undefined {
    return this.morph?.weights;
  }

  /**
   * Replaces the morph weights array; a no-op when the geometry has no morph targets or `value` is `undefined`
   * @param value - New weights, one per morph target.
   */
  set weights(value: Float32Array | undefined) {
    if (this.morph && value) this.morph.weights = value;
  }

  /** Vertex/index data drawn by this mesh; reassigning marks the per-pass cache dirty */
  get geometry(): Geometry3D {
    return this._geometry;
  }

  /**
   * Swaps the geometry, dirtying the batch/store caches, the world bounding sphere and a string `hitVolume`
   * @param value - Geometry to draw.
   */
  set geometry(value: Geometry3D) {
    if (this._geometry === value) return;
    this._geometry = value;
    this._batchDirty = true;
    // The store entry carries the geometry's bounds-buffer index at [18], so a
    // geometry swap must re-run copyMeshData to refresh it (mirrors set material).
    this._storeDirty = true;
    // New geometry → new local sphere; force boundingSphere to rebuild (the transform is unchanged).
    this._worldBoundsCacheId = -1;
    // A string hit volume ('box' / 'geometry') was resolved against the previous geometry, so it
    // must follow the swap. Explicit shapes are the user's own, and the default AABB is read live
    // from `_geometry` at pick time; neither needs anything here.
    if (typeof this._hitVolumeInput === 'string') {
      this._hitVolumeResolved = resolveHitVolume(this, this._hitVolumeInput);
    }
  }

  /**
   * Hit volume used when an interactive mesh sets no explicit `hitVolume`
   *
   * Read per pick rather than cached, so geometry swaps and in-place bounds mutations take
   * effect immediately.
   * @internal
   * @returns The geometry's local-space AABB, {@link Geometry3D.bounds3D}
   */
  public override _getDefaultHitVolume(): HitVolume3D {
    return this._geometry.bounds3D;
  }

  /**
   * Material applied to {@link Mesh3D.geometry | geometry}
   *
   * Reassigning marks the per-pass cache dirty, re-evaluates the shadow bit, and flags the
   * store buffer for re-upload.
   */
  get material(): BaseMaterial3D {
    return this._material;
  }

  /**
   * Swaps the material, dirtying the batch/store caches and re-evaluating shadow-pass membership
   * @param value - Material to draw the geometry with.
   */
  set material(value: BaseMaterial3D) {
    if (this._material === value) return;
    this._material = value;
    this._batchDirty = true;
    this._storeDirty = true;
    // The watermark tracks a (mesh, material) binding; a swap re-points it at a
    // different material's counter, where an equal value would be a coincidence,
    // not "unchanged". Reset so the next walk always re-claims against the new one.
    this._lastDescriptorDirtyId = -1;
    this.updateShadow();
  }

  /**
   * Whether this mesh casts shadows
   *
   * Records user intent. Translucent (`alphaMode === 'blend'`) and transmissive materials are
   * excluded from the shadow pass even when this is `true` — see {@link Mesh3D.updateShadow}.
   */
  get castShadow(): boolean {
    return this._castShadowIntent;
  }

  /**
   * Records the shadow-casting intent and re-evaluates shadow-pass membership
   * @param value - Whether the mesh should cast shadows; blended and transmissive materials still won't.
   */
  set castShadow(value: boolean) {
    if (this._castShadowIntent === value) return;
    this._castShadowIntent = value;
    this.updateShadow();
  }

  /**
   * Orients this mesh toward the camera in the vertex shader, rebuilding it
   * around the node's world origin from the model matrix's column lengths
   *
   * See {@link BillboardMode} for the modes.
   *
   * Works on any geometry. The shader rebuilds all three local axes in a basis
   * aimed at the camera, so a flat card ends up facing the lens and a solid mesh
   * keeps its depth while turning to face it. Local `+Z` is the axis that ends up
   * pointing at the viewer, which is the face a card should be authored on.
   *
   * The core material systems inject the shader bit from this flag, the same
   * route `skeleton` takes for skinning, so it composes with any material, lit or
   * unlit. Reassigning recompiles on the next frame.
   *
   * Batch slots ({@link BatchedMesh3D}) carry the flag too, but need
   * `invalidate(index)` after a change, as every slot-level shader change does.
   */
  get billboardMode(): BillboardMode {
    return this._billboardMode;
  }

  /**
   * Switches the billboard basis, recompiling the shader variant on the next frame
   * @param value - How to orient the mesh toward the camera, or `'none'` to draw it as authored.
   */
  set billboardMode(value: BillboardMode) {
    if (this._billboardMode === value) return;
    this._billboardMode = value;
    // Picks the shader variant, so the per-pass cache has to rebuild.
    this._batchDirty = true;
  }

  /**
   * Bitmask of render passes this mesh belongs to
   *
   * OR's the cached mesh pass bits (`renderPassBits`) with the material's `_passBit`.
   */
  get renderPassMask(): number {
    return this.renderPassBits | this._material._passBit;
  }

  /**
   * This mesh's world-space bounding {@link Sphere}
   *
   * The geometry's local bounding sphere ({@link Geometry3D.boundsSphere}) transformed by
   * {@link Container3D.worldTransform | worldTransform}, with a conservative radius under scale.
   *
   * Cached and rebuilt lazily: recomputes only when the world transform changes (tracked by
   * `Container3D._worldTransformId`, bumped in the transform pass) or the geometry is swapped.
   * So repeated reads in a frame — and across every render pass that culls this mesh — reuse one
   * computation. The value reflects the last resolved world transform, so read it after the View's
   * transform pass (mirroring {@link Container3D.worldTransform}'s own contract).
   *
   * Dynamic geometry carries no registered bounds, so the returned sphere is empty (`radius < 0`).
   * Returns the shared cached instance — do not mutate it; `clone()` if you need a snapshot.
   */
  public get boundingSphere(): Sphere {
    // Lazily allocated — a fresh sphere starts empty with cacheId `-1`, so the block below always
    // runs on first use and builds it.
    const sphere = (this._worldBoundsSphere ||= new Sphere());
    if (this._worldBoundsCacheId !== this._worldTransformId) {
      this._worldBoundsCacheId = this._worldTransformId;
      const geometry = this._geometry;
      if (geometry.dynamic) {
        sphere.makeEmpty();
      } else if (geometry._morphBoundsExpansion > 0) {
        // Expand the local sphere by the conservative morph reach before the
        // world transform, so the expansion scales with the mesh (mirrors the
        // geometry-store row the GPU cull reads).
        _morphExpandedSphere.copyFrom(geometry.boundsSphere);
        _morphExpandedSphere.radius += geometry._morphBoundsExpansion;
        _morphExpandedSphere.applyMatrix4(this.worldTransform, sphere);
      } else {
        // Transform the geometry's precomputed local sphere into world space.
        geometry.boundsSphere.applyMatrix4(this.worldTransform, sphere);
      }
    }
    return sphere;
  }

  /**
   * Recomputes the SHADOW pass bit from the current {@link Mesh3D.castShadow | castShadow}
   * intent and the assigned material's pass
   *
   * Called automatically when `castShadow` or `material` is set. Call this yourself if you mutate
   * the existing material's `alphaMode` or `transmission` at runtime — the material has no
   * back-reference to its meshes and can't trigger the update on its own.
   */
  public updateShadow(): void {
    const translucent = RenderPassBit.TRANSPARENT | RenderPassBit.TRANSMISSION;
    const isTranslucent = (this._material._passBit & translucent) !== 0;
    const prev = this.renderPassBits;
    if (this._castShadowIntent && !isTranslucent) {
      this.renderPassBits |= RenderPassBit.SHADOW;
    } else {
      this.renderPassBits &= ~RenderPassBit.SHADOW;
    }

    // Joining a pass changes membership (`renderPassMask`), and `setItemActive`
    // will happily add the mesh to that pass's draw list — but only the
    // `_batchDirty` path populates `_passCache[SHADOW]`. Without this, a mesh
    // that opts into shadows after creation draws from a cache entry that was
    // never built. No-op flips stay free.
    if (this.renderPassBits !== prev) this._batchDirty = true;
  }

  /**
   * Forces a rebuild of the mesh's per-pass cache (`_passCache[bit]`): recompile shaders,
   * re-resolve state/topology, recompute batch keys
   *
   * Most mutations auto-invalidate via setters or `_invalidateDescriptor` (see
   * {@link BaseMaterial3D} class docs for the full matrix). Call this manually when:
   *
   * - You mutated `material._passes` directly (e.g. replaced a `PassDescriptor` entry's `shader`
   *   after first render).
   * - You modified geometry attributes (e.g. added a tangent attribute) or changed a custom
   *   material's variant bits without going through `_invalidateDescriptor`.
   * - You replaced the source `State` reference inside a `PassDescriptor` (mutating its
   *   properties propagates live; replacing the reference does not).
   */
  public invalidate(): void {
    this._batchDirty = true;
  }

  /**
   * Give this mesh's geometry memory back now — its GPU buffers and the range it holds in the
   * shared geometry atlas. The CPU-side vertex data stays, so the next frame that draws this
   * mesh re-uploads and re-packs it and renders identically.
   *
   * The material is deliberately untouched: one material typically dresses many meshes, so
   * unloading it from here would reach far outside this mesh. Call
   * {@link BaseMaterial3D.unload} for that, or {@link Model3D.unload} to give back a model's
   * geometry and textures together.
   *
   * Legal but pointless on a mesh that is still being drawn — the next frame rebuilds
   * everything it just freed. Remove the mesh from the scene first.
   * @example
   * ```ts
   * view.root.removeChild(mesh);
   * mesh.unload(); // adding it back re-uploads and re-packs the geometry
   * ```
   * @see {@link Geometry3D.unload} For what this frees.
   * @see {@link Mesh3D.destroy} For permanent teardown.
   */
  public override unload(): void {
    if (this.destroyed) return;

    super.unload();
    this._geometry.unload();

    // The atlas range is gone, so the recorded draw args are stale. `_batchDirty` is what
    // re-packs the geometry and re-keys this mesh; `_storeDirty` re-emits the store row that
    // carries the geometry's store index.
    this._batchDirty = true;
    this._storeDirty = true;
  }

  /**
   * Publishes the freshly recomputed world matrix into this mesh's store row
   *
   * Runs inside the transform pass, so the matrix is written while it is hot instead of
   * being re-read cold by the scene sweep. Only the matrix lanes move; the u32 lanes stay
   * event-driven through `_storeDirty`. A mesh with no row yet (first frame after attach)
   * defers to the sweep, which allocates and copies the full row.
   *
   * A non-negative `_storeIndex` is trusted exactly as the sweep's `set` trusts it: it names a
   * live row of `view3d._sceneBatch.storeBuffer`. That store is the only one that mints the
   * index and is never swapped on its View; `View3D._detach` resets the index before this mesh
   * can join another View, and a View destroys the store only after every mesh has left it.
   * @internal
   */
  public override _storeWorldTransform(): void {
    const index = this._storeIndex;

    if (index < 0) {
      this._storeDirty = true;

      return;
    }

    this._view3d!._sceneBatch.storeBuffer.writeWorldTransform(index, this.worldTransform.elements64);
  }

  /**
   * Tears down this mesh
   *
   * {@link Container3D.destroy | super.destroy} runs first so the {@link View3D} detaches the
   * mesh (clearing its store / mesh / skinned-mesh indices and removing it from the scene batch)
   * while those slots are still live.
   *
   * Geometry and material are shared by default and left intact; pass `geometry` / `material` to
   * destroy them. `texture` then frees the destroyed material's textures, and `textureSource`
   * their sources. The {@link Mesh3D.skeleton} is always shared and never destroyed here — it
   * belongs to the owning {@link Model3D}.
   * @param options - Teardown flags; see {@link Destroy3DOptions}.
   */
  public override destroy(options?: Destroy3DOptions): void {
    if (this.destroyed) return;

    super.destroy(options);

    this._passCache = Object.create(null);
    this._storeIndex = -1;
    this._allMeshIndex = -1;
    this._skinnedMeshIndex = -1;
    this._morphedMeshIndex = -1;

    if (resolveDestroy3DFlag(options, 'geometry')) this._destroyGeometry();

    if (resolveDestroy3DFlag(options, 'material')) this._material.destroy(options);

    this._geometry = null!;
    this._material = null!;
  }

  /**
   * Frees this mesh's geometry when `destroy` is asked for `geometry`. Subclasses whose geometry is
   * never theirs to free on request override it as a no-op — a {@link Sprite3D}'s quad is a
   * process-wide singleton — so the caller's flags keep travelling to the children untouched.
   */
  protected _destroyGeometry(): void {
    this._geometry.destroy(true);
  }
}
