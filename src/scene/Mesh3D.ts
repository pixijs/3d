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
 * How a mesh turns to face the camera; see {@link Mesh3D#billboardMode}
 *
 * - `'none'`: no turning; the mesh draws as authored. The default.
 * - `'spherical'`: lies square to the screen however the camera turns. Suits glows, impact
 *   flashes, icons and distance markers.
 * - `'cylindrical'`: turns around its own up axis toward the camera but never tips, so it stays
 *   planted. Suits trees, grass, crowd cutouts and flat stand-ins for distant models.
 *
 * The vertex shader does the turning, so it works with any material, a lit one as well as an
 * unlit card, and any geometry, flat or solid.
 * @example
 * ```ts
 * const mode: BillboardMode = upright ? 'cylindrical' : 'spherical';
 * const marker = new Sprite3D({ texture, billboardMode: mode });
 * ```
 * @category scene
 * @standard
 */
export type BillboardMode = 'none' | 'spherical' | 'cylindrical';

/**
 * Constructor options for {@link Mesh3D}
 *
 * `geometry` and `material` are required. The {@link Container3DOptions} apply too, and `label`
 * defaults to `'Mesh3D'`.
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
  /**
   * The geometry to draw; required
   * @example
   * ```ts
   * const ball = new Mesh3D({ geometry: new SphereGeometry(), material });
   * ```
   */
  geometry: Geometry3D;
  /**
   * The material to draw the geometry with; required
   * @example
   * ```ts
   * const ball = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xff8844 }) });
   * ```
   */
  material: BaseMaterial3D;
  /**
   * Skeleton that deforms the mesh; leave it out for a mesh that doesn't bend
   *
   * The geometry needs `joints` and `weights` for it to act on.
   * @example
   * ```ts
   * const tailMesh = new Mesh3D({ geometry: tailGeometry, material, skeleton: tail });
   * ```
   */
  skeleton?: Skeleton;
  /**
   * Whether the mesh casts shadows; see {@link Mesh3D#castShadow}
   * @default true
   * @example
   * ```ts
   * const decal = new Mesh3D({ geometry, material, castShadow: false });
   * ```
   */
  castShadow?: boolean;
  /**
   * Whether the mesh is shadowed; see {@link Mesh3D#receiveShadow}
   * @default true
   * @example
   * ```ts
   * const water = new Mesh3D({ geometry, material, receiveShadow: false });
   * ```
   */
  receiveShadow?: boolean;
  /**
   * Starting morph target weights, one per target in the geometry; left out, they're all 0
   *
   * Ignored when the geometry has no morph targets. See {@link Mesh3D#weights}.
   * @example
   * ```ts
   * const face = new Mesh3D({ geometry: faceGeometry, material, weights: new Float32Array([0, 1]) });
   * ```
   */
  weights?: Float32Array;
  /**
   * How the mesh turns to face the camera; see {@link Mesh3D#billboardMode}
   * @default 'none'
   * @example
   * ```ts
   * const card = new Mesh3D({ geometry: new PlaneGeometry(), material, billboardMode: 'cylindrical' });
   * ```
   */
  billboardMode?: BillboardMode;
}

/**
 * A drawable node: a {@link Geometry3D} drawn with a {@link BaseMaterial3D}
 *
 * Add it anywhere under {@link View3D.root | view.root} and the view draws it in the passes its
 * material and settings call for: opaque, transparent, shadow and so on. A mesh with a
 * {@link Skeleton} bends with its bones, and one whose geometry has morph targets gets a
 * {@link Morph}. For thousands of copies, {@link BatchedMesh3D} draws them without a node each.
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
   * `new Mesh3D(opts)` resolves as `{ ...Mesh3D.defaultOptions, ...opts }`, ignoring options set
   * to `undefined`. Mutate to change the defaults process-wide. `geometry`, `material` and
   * `skeleton` have no default here.
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

  /** Cache behind {@link Mesh3D#boundingSphere}, made on first read: only culled meshes need one */
  private _worldBoundsSphere: Sphere | null = null;
  /**
   * `Container3D._worldTransformId` the cached sphere was built against
   *
   * `-1` forces a rebuild: at first, and whenever the geometry, and with it the local sphere, is
   * swapped, since that doesn't move the transform.
   */
  private _worldBoundsCacheId = -1;
  /** Whether the user asked for shadows; {@link Mesh3D#updateShadow} decides if the mesh casts them */
  private _castShadowIntent: boolean;

  /**
   * Skeleton that deforms this mesh; `undefined` for a mesh that doesn't bend
   *
   * Fixed at construction: to change it, build a new mesh.
   * @example
   * ```ts
   * const head = mesh.skeleton?.indexOf('Head');
   * ```
   */
  public readonly skeleton?: Skeleton;

  /**
   * Whether this mesh is shadowed by lights that cast shadows
   *
   * Only lit materials take shadows. Their shader leaves the shadow lookup out until a light in
   * the view first casts a shadow, and keeps it from then on. After changing this at runtime, call
   * {@link Mesh3D#invalidate | invalidate} so the shader is rebuilt.
   * @example
   * ```ts
   * water.receiveShadow = false;
   * water.invalidate();
   * ```
   */
  public receiveShadow: boolean;

  /**
   * The mesh's morph target state; `undefined` when its geometry has no morph targets
   *
   * So it doubles as the check for a morphed mesh, as {@link Mesh3D#skeleton} does for a skinned
   * one.
   * @example
   * ```ts
   * if (mesh.morph) mesh.morph.weights.fill(0);
   * ```
   */
  public readonly morph?: Morph;

  /**
   * The mesh's own pass bits, today only `SHADOW` from {@link Mesh3D#updateShadow}
   *
   * OR'd with the material's `_passBit` to give {@link Mesh3D#renderPassMask}.
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
   * Draw-order key for the pass being keyed; `updateMesh3DKeys` owns its layout
   * @internal
   */
  public _sortKey = 0;

  /**
   * Whether the mesh's per-pass cache is stale and needs rebuilding
   * @internal
   */
  public _batchDirty = true;

  /**
   * {@link RenderPassBit} flags of the passes the mesh is a member of, compared with
   * {@link Mesh3D#renderPassMask} to catch a change
   * @internal
   */
  public _lastRenderPass = 0;

  /**
   * Last `material._descriptorDirtyId` this mesh rebuilt against, to catch shader-variant and
   * pass changes
   *
   * `-1` makes the next frame rebuild. Swapping the material resets it: the id counts per
   * material, so an equal value on the new one would be a coincidence, not "unchanged".
   * @internal
   */
  public _lastDescriptorDirtyId = -1;

  /**
   * Last {@link Container3D.worldVisible} value the render side saw (see `updateView3DScene`)
   *
   * A flip re-emits the store row, whose visibility lane mirrors `worldVisible`, and bumps the
   * batch's visibility dirty-id. Hiding and showing then change only draw data, not membership,
   * so no draw commands or bundles are rebuilt.
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
   * Creates a new `Mesh3D`; add it under {@link View3D.root | view.root} to draw it
   *
   * `hitVolume`, `width`, `height`, `depth` and `parent` are applied last, once the mesh is built:
   * the first four measure the geometry, and attaching to a view registers the skeleton and morph.
   * @example
   * ```ts
   * const mesh = new Mesh3D({ geometry, material });
   * view.root.addChild(mesh);
   * ```
   * @param options - Construction options; see {@link Mesh3DOptions}.
   */
  constructor(options: Mesh3DOptions) {
    /**
     * The mesh's own options, pulled out so the base constructor's option loop never assigns them:
     * `geometry` and `material` have setters over fields not yet set, and `weights` needs the
     * morph state
     */
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
   * Morph target weights, one per target; `undefined` when the geometry has no morph targets
   *
   * The same array as {@link Morph#weights}: write into it, and animations do too. Replacing the
   * array has a catch, which `Morph#weights` explains.
   * @example
   * ```ts
   * if (face.weights) face.weights[smileIndex] = 0.8;
   * ```
   */
  get weights(): Float32Array | undefined {
    return this.morph?.weights;
  }

  /**
   * Replaces the weights array; does nothing when the geometry has no morph targets or `value` is
   * `undefined`
   * @param value - New weights, one per morph target.
   */
  set weights(value: Float32Array | undefined) {
    if (this.morph && value) this.morph.weights = value;
  }

  /**
   * The geometry this mesh draws
   *
   * Assigning another rebuilds the mesh's shader on the next frame, for the new vertex layout.
   * @example
   * ```ts
   * rock.geometry = isFar ? lowDetailRock : highDetailRock;
   * ```
   */
  get geometry(): Geometry3D {
    return this._geometry;
  }

  /**
   * Swaps the geometry
   *
   * The mesh rebuilds its shader, its store row and its {@link Mesh3D#boundingSphere} for it. A
   * `hitVolume` given as `'box'` or `'geometry'` is fitted to the new geometry. A hit shape you
   * gave yourself stays, and the default box is read from the geometry at pick time.
   * @param value - Geometry to draw.
   */
  set geometry(value: Geometry3D) {
    if (this._geometry === value) return;
    this._geometry = value;
    this._batchDirty = true;
    this._storeDirty = true;
    this._worldBoundsCacheId = -1;
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
   * The material this mesh draws with
   *
   * Assigning another rebuilds the mesh's shader on the next frame and checks again whether the
   * mesh casts shadows.
   * @example
   * ```ts
   * crate.material = selected ? highlightMaterial : crateMaterial;
   * ```
   */
  get material(): BaseMaterial3D {
    return this._material;
  }

  /**
   * Swaps the material, rebuilding the mesh's shader and store row and checking its shadow casting
   * again
   * @param value - Material to draw the geometry with.
   */
  set material(value: BaseMaterial3D) {
    if (this._material === value) return;
    this._material = value;
    this._batchDirty = true;
    this._storeDirty = true;
    this._lastDescriptorDirtyId = -1;
    this.updateShadow();
  }

  /**
   * Whether this mesh casts shadows
   *
   * A mesh whose material has `alphaMode: 'blend'`, or uses transmission, casts none even while
   * this is `true`. See {@link Mesh3D#updateShadow | updateShadow} for a material changed after
   * the mesh got it.
   * @example
   * ```ts
   * grass.castShadow = false;
   * ```
   */
  get castShadow(): boolean {
    return this._castShadowIntent;
  }

  /**
   * Sets whether the mesh should cast shadows and checks whether it can
   * @param value - Whether the mesh should cast shadows; blended and transmissive materials still won't.
   */
  set castShadow(value: boolean) {
    if (this._castShadowIntent === value) return;
    this._castShadowIntent = value;
    this.updateShadow();
  }

  /**
   * How this mesh turns to face the camera; see {@link BillboardMode} for the modes
   *
   * The vertex shader rebuilds the mesh around its world position in axes aimed at the camera,
   * keeping the scale of each axis. A flat card ends up facing the lens, and a solid mesh keeps its
   * depth while it turns. Local `+Z` ends up pointing at the viewer, so author a card facing `+Z`.
   * It works with any material, lit or unlit. Changing it recompiles the mesh's shader on the next
   * frame.
   *
   * {@link BatchedMesh3D} slots have it too, through {@link BatchedMesh3D#items | items}, and need
   * {@link BatchedMesh3D#invalidate | invalidate} after a change.
   * @example
   * ```ts
   * card.billboardMode = 'cylindrical';
   * ```
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
    this._batchDirty = true;
  }

  /**
   * The {@link RenderPassBit} flags of the passes that draw this mesh: its material's passes, plus
   * `SHADOW` while it casts shadows
   * @example
   * ```ts
   * const castsShadow = (mesh.renderPassMask & RenderPassBit.SHADOW) !== 0;
   * ```
   * @advanced
   */
  get renderPassMask(): number {
    return this.renderPassBits | this._material._passBit;
  }

  /**
   * This mesh's bounding {@link Sphere} in world space
   *
   * The geometry's {@link Geometry3D.boundsSphere} moved by
   * {@link Container3D.worldTransform | worldTransform}, its radius scaled by the transform's
   * largest axis scale. A morphed mesh's sphere grows by the farthest its morph targets can move a
   * vertex at weights from 0 to 1, as the GPU cull's does, so it holds every pose.
   *
   * It's rebuilt only when the world transform or the geometry changes, so every read in a frame,
   * including each render pass that culls the mesh, shares one computation. It follows the last
   * world transform the view worked out, so read it after the view's transform pass, as with
   * `worldTransform`.
   *
   * Dynamic geometry has no bounds, so its sphere is empty (`radius < 0`). The sphere is shared:
   * don't change it, and `clone()` it to keep a copy.
   * @example
   * ```ts
   * if (camera.frustum.intersectsSphere(enemy.boundingSphere)) enemy.lookAt(player.position);
   * ```
   */
  public get boundingSphere(): Sphere {
    const sphere = (this._worldBoundsSphere ||= new Sphere());
    if (this._worldBoundsCacheId !== this._worldTransformId) {
      this._worldBoundsCacheId = this._worldTransformId;
      const geometry = this._geometry;
      if (geometry.dynamic) {
        sphere.makeEmpty();
      } else if (geometry._morphBoundsExpansion > 0) {
        _morphExpandedSphere.copyFrom(geometry.boundsSphere);
        _morphExpandedSphere.radius += geometry._morphBoundsExpansion;
        _morphExpandedSphere.applyMatrix4(this.worldTransform, sphere);
      } else {
        geometry.boundsSphere.applyMatrix4(this.worldTransform, sphere);
      }
    }
    return sphere;
  }

  /**
   * Works out again whether this mesh casts shadows, from {@link Mesh3D#castShadow | castShadow}
   * and its material
   *
   * Setting `castShadow` or `material` calls it. Call it yourself after switching the mesh's
   * material to or from `alphaMode: 'blend'`: a material doesn't know its meshes, so it can't tell
   * them.
   *
   * When the answer changes, the mesh rebuilds on the next frame, which gives the shadow pass
   * draw state for a mesh that starts casting.
   * @example
   * ```ts
   * glass.alphaMode = 'blend';
   * for (const mesh of glassMeshes) mesh.updateShadow();
   * ```
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

    if (this.renderPassBits !== prev) this._batchDirty = true;
  }

  /**
   * Makes the mesh rebuild its shader and draw state on the next frame
   *
   * Assigning `geometry`, `material` or `billboardMode` does this for you, and so do most material
   * changes; {@link BaseMaterial3D} lists the ones that need this call. Call it too after changing
   * {@link Mesh3D#receiveShadow | receiveShadow}, or after editing the geometry's attributes in
   * place, such as adding tangents.
   * @example
   * ```ts
   * mesh.receiveShadow = false;
   * mesh.invalidate();
   * ```
   */
  public invalidate(): void {
    this._batchDirty = true;
  }

  /**
   * Frees this mesh's geometry from the GPU now: its buffers and its range in the shared geometry
   * buffer
   *
   * The vertex data stays on the CPU, so the next frame that draws the mesh uploads it again and
   * draws the same image. The mesh also rebuilds then, since its recorded draw points at the range
   * the geometry gave up.
   *
   * The material is left alone, since one material usually dresses many meshes. Call
   * {@link BaseMaterial3D.unload} for that, or {@link Model3D.unload} to free a model's geometry
   * and textures together. Unloading a mesh that's still drawn works but gains nothing, since the
   * next frame uploads it all again; remove it from the scene first.
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
   * Destroys this mesh
   *
   * Geometry and material are often shared, so they stay unless you pass `geometry` or
   * `material`. `texture` then frees the destroyed material's textures, and `textureSource` their
   * sources. The {@link Mesh3D#skeleton | skeleton} is never destroyed here: its {@link Model3D},
   * or whoever built it, owns it.
   *
   * The base `destroy` runs first, so the view lets go of the mesh while its slots in the view's
   * lists are still live.
   * @example
   * ```ts
   * mesh.destroy({ geometry: true, material: true });
   * ```
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
   * Frees this mesh's geometry when `destroy` is asked for `geometry`
   *
   * A subclass whose geometry is never its to free overrides it as a no-op, as {@link Sprite3D}
   * does for its shared quad, so the caller's flags still reach the children unchanged.
   */
  protected _destroyGeometry(): void {
    this._geometry.destroy(true);
  }
}
