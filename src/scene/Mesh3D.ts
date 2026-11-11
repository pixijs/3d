import { definedProps } from 'pixi.js';

import type { Mesh3DData, MeshPassCache } from '../core/batcher/Mesh3DData';
import { passBitRegistry } from '../core/render-passes/passBitRegistry';
import { RenderPassBit } from '../core/render-passes/RenderPass';
import type { HitVolume3D } from '../events/HitResult3D';
import { resolveHitVolume } from '../events/resolveHitVolume';
import { Geometry3D } from '../geometry/Geometry3D';
import { BaseMaterial3D } from '../materials/BaseMaterial3D';
import { Sphere } from '../math/shapes/Sphere';
import type { Destroy3DOptions } from '../utils/Destroy3DOptions';
import { resolveDestroy3DFlag } from '../utils/Destroy3DOptions';
import type { Container3DOptions } from './Container3D';
import { Container3D } from './Container3D';
import { Morph } from './Morph';
import type { Skeleton } from './Skeleton';

const _morphExpandedSphere = new Sphere();

/**
 * How a mesh turns to face the camera; see {@link Mesh3D#billboardMode}
 *
 * - `'none'`: no turning; the mesh draws as authored.
 * - `'spherical'`: lies square to the screen however the camera turns. Suits glows, impact
 *   flashes, icons and distance markers.
 * - `'cylindrical'`: turns around its own up axis toward the camera but never tips, so it stays
 *   planted. Suits trees, grass, crowd cutouts and flat stand-ins for distant models.
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
 * `geometry` and `material` can be left out: a mesh built without them draws nothing until both
 * are assigned. The {@link Container3DOptions} apply too, and `label` defaults to `'Mesh3D'`.
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
 * @category scene
 * @standard
 */
export interface Mesh3DOptions extends Container3DOptions {
  /**
   * The geometry to draw
   *
   * Left out, the mesh holds {@link Geometry3D.EMPTY} and draws nothing until you assign
   * {@link Mesh3D#geometry}.
   * @example
   * ```ts
   * const ball = new Mesh3D({ geometry: new SphereGeometry(), material });
   * ```
   */
  geometry?: Geometry3D;
  /**
   * The material to draw the geometry with
   *
   * Left out, the mesh holds {@link BaseMaterial3D.EMPTY} and draws nothing until you assign
   * {@link Mesh3D#material}.
   * @example
   * ```ts
   * const ball = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xff8844 }) });
   * ```
   */
  material?: BaseMaterial3D;
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
   * Ignored when the geometry has no morph targets, or isn't given yet: weights exist only once
   * the mesh has a morph geometry, so set {@link Mesh3D#weights} after assigning one.
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
 * {@link Skeleton} bends with its bones, and one whose geometry has morph targets blends them by
 * its {@link Mesh3D#weights | weights}. For thousands of copies, {@link BatchedMesh3D} draws them
 * without a node each.
 *
 * The geometry and material can come later: until it has both, a mesh draws nothing. Assigning
 * them, before or after the mesh joins a view, gives the same mesh as passing them to the
 * constructor, and a {@link Mesh3D#castShadow}, {@link Mesh3D#enablePass} or
 * {@link Mesh3D#disablePass} change made while it waits applies once it has both.
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
 * // Geometry and material assigned later:
 * const later = new Mesh3D({ parent: view.root });
 * later.geometry = geometry;
 * later.material = material;
 *
 * // Toggle shadow casting at runtime:
 * mesh.castShadow = false;
 * ```
 * @see {@link Mesh3DOptions} For the constructor options.
 * @category scene
 * @standard
 */
export class Mesh3D extends Container3D implements Mesh3DData {
  /**
   * Defaults for every new `Mesh3D`; an option passed as `undefined` keeps its default
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
  /** `0` while the geometry or material is a placeholder, else `~0`; cached to skip the `EMPTY` getters per frame */
  private _placeholderMask = 0;
  private _billboardMode: BillboardMode;

  private _worldBoundsSphere: Sphere | null = null;
  private _worldBoundsCacheId = -1;

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
   * Only lit materials take shadows. After changing it at runtime, call
   * {@link Mesh3D#invalidate | invalidate}.
   * @example
   * ```ts
   * water.receiveShadow = false;
   * water.invalidate();
   * ```
   */
  public receiveShadow: boolean;

  /** @internal */
  public _morph?: Morph;

  /** @internal */
  public _enabledPassBits = 0;

  /** @internal */
  public _disabledPassBits = 0;

  /** @internal */
  public _passCache: Record<number, MeshPassCache> = Object.create(null);

  /** @internal */
  public _storeIndex = -1;

  /** @internal */
  public _lastBonePitIndex = -1;

  /** @internal */
  public _sortKey = 0;

  /**
   * Raise it with `_markBatchDirty`; the flag alone does nothing until the mesh is queued
   * @internal
   */
  public _batchDirty = true;

  /**
   * Whether the mesh is in its view's update queue
   * @internal
   */
  public didRenderableUpdate = false;

  /** @internal */
  // unused-internal-disable-next-line -- `Geometry3D._meshes` reads and writes it through its UnstableList index key
  public _geometryMeshIndex = -1;

  /** @internal */
  // unused-internal-disable-next-line -- `BaseMaterial3D._meshes` reads and writes it through its UnstableList index key
  public _materialMeshIndex = -1;

  /** @internal */
  public _lastRenderPass = 0;

  /** @internal */
  public _lastDescriptorDirtyId = -1;

  /** @internal */
  public _lastWorldVisible = 1;

  /** @internal */
  public _skinnedMeshIndex = -1;

  /** @internal */
  public _morphedMeshIndex = -1;

  /** @internal */
  public _allMeshIndex = -1;

  /**
   * Creates a new `Mesh3D`; add it under {@link View3D.root | view.root} to draw it
   * @example
   * ```ts
   * const mesh = new Mesh3D({ geometry, material });
   * view.root.addChild(mesh);
   * ```
   * @param options - Construction options; see {@link Mesh3DOptions}.
   */
  constructor(options: Mesh3DOptions = {}) {
    /** Held out of `Container3D`'s constructor, which would assign them before the mesh is ready */
    const {
      geometry = Geometry3D.EMPTY,
      material = BaseMaterial3D.EMPTY,
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
    this._updatePlaceholderMask();
    this.skeleton = skeleton;
    if (castShadow) this._enabledPassBits = RenderPassBit.SHADOW;
    this.receiveShadow = receiveShadow!;
    this._billboardMode = billboardMode!;
    if (geometry.morphTargetCount > 0) {
      this._morph = new Morph(weights ?? new Float32Array(geometry.morphTargetCount));
    }
    if (hitVolume !== undefined) this.hitVolume = hitVolume;
    if (width !== undefined) this.width = width;
    if (height !== undefined) this.height = height;
    if (depth !== undefined) this.depth = depth;
    parent?.addChild(this);
  }

  /**
   * Morph target weights, one per target; `undefined` when the geometry has no morph targets
   *
   * Change its values at any time rather than assigning a new array: a playing animation keeps
   * writing the old one, and the parts a model node's mesh splits into share one array, so a new
   * array cuts this mesh loose from both.
   * @example
   * ```ts
   * if (face.weights) face.weights[smileIndex] = 0.8;
   * ```
   */
  get weights(): Float32Array | undefined {
    return this._morph?.weights;
  }

  /**
   * Replaces the weights array; does nothing when the geometry has no morph targets or `value` is
   * `undefined`
   * @param value - New weights, one per morph target.
   */
  set weights(value: Float32Array | undefined) {
    if (this._morph && value) this._morph.weights = value;
  }

  /**
   * The geometry this mesh draws; {@link Geometry3D.EMPTY} until it's given one
   * @example
   * ```ts
   * rock.geometry = isFar ? lowDetailRock : highDetailRock;
   * ```
   */
  get geometry(): Geometry3D {
    return this._geometry;
  }

  /**
   * Swaps the geometry, refitting a `hitVolume` given as `'box'` or `'geometry'`
   *
   * A geometry with as many morph targets as there are {@link Mesh3D#weights} keeps them; one with
   * a different count gets new weights, all 0; one with none leaves `weights` undefined.
   * @param value - Geometry to draw.
   */
  set geometry(value: Geometry3D) {
    if (this._geometry === value) return;
    if (this._view3d) {
      this._geometry._meshes.remove(this);
      value._meshes.add(this);
    }
    this._geometry = value;
    this._markBatchDirty();
    this._markStoreDirty();
    this._worldBoundsCacheId = -1;
    this._updatePlaceholderMask();
    if (value.morphTargetCount !== (this._morph?.weights.length ?? 0)) this._replaceMorph();
    if (typeof this._hitVolumeInput === 'string') {
      this._hitVolumeResolved = resolveHitVolume(this, this._hitVolumeInput);
    }
  }

  private _replaceMorph(): void {
    const old = this._morph;
    old?._store?.freeSlot(old);

    const count = this._geometry.morphTargetCount;
    const morph = count > 0 ? new Morph(new Float32Array(count)) : undefined;
    this._morph = morph;

    const view = this._view3d;
    if (!view) return;
    if (old && !morph) view._morphedMeshes.remove(this);
    else if (!old && morph) view._morphedMeshes.add(this);
  }

  /** @internal */
  public override _getDefaultHitVolume(): HitVolume3D {
    return this._geometry.bounds3D;
  }

  /**
   * The material this mesh draws with; {@link BaseMaterial3D.EMPTY} until it's given one
   *
   * Many meshes can draw one material, and a value written to it shows on all of them. A
   * {@link Model3D}'s meshes draw its source's materials, shared with every model built from that
   * source; {@link Model3D#materials} gives one model copies of its own. For one mesh alone, assign
   * `mesh.material.clone({ baseColor: 0xff0000 })`, and destroy the copy when you're done with it.
   * @example
   * ```ts
   * crate.material = selected ? highlightMaterial : crateMaterial;
   * ```
   */
  get material(): BaseMaterial3D {
    return this._material;
  }

  /**
   * Swaps the material
   * @param value - Material to draw the geometry with.
   */
  set material(value: BaseMaterial3D) {
    if (this._material === value) return;
    if (this._view3d) {
      this._material._meshes.remove(this);
      value._meshes.add(this);
    }
    this._material = value;
    this._markBatchDirty();
    this._markStoreDirty();
    this._lastDescriptorDirtyId = -1;
    this._updatePlaceholderMask();
  }

  private _updatePlaceholderMask(): void {
    this._placeholderMask = this._geometry === Geometry3D.EMPTY || this._material === BaseMaterial3D.EMPTY ? 0 : ~0;
  }

  /** @internal */
  public _markBatchDirty(): void {
    this._batchDirty = true;
    this._queueMeshUpdate();
  }

  /** @internal */
  public _markStoreDirty(): void {
    this._storeDirty = true;
    this._queueMeshUpdate();
  }

  /** @internal */
  public _queueMeshUpdate(): void {
    if (this.didRenderableUpdate || !this._view3d) return;
    this.didRenderableUpdate = true;
    this._view3d._onRenderableUpdate(this);
  }

  /**
   * Whether this mesh casts shadows
   *
   * A mesh whose material has `alphaMode: 'blend'`, or uses transmission, casts none even while
   * this is `true`. Setting it is `enablePass('shadow')` or `disablePass('shadow')`.
   * @example
   * ```ts
   * grass.castShadow = false;
   * ```
   */
  get castShadow(): boolean {
    return (this._enabledPassBits & RenderPassBit.SHADOW) !== 0;
  }

  /**
   * Sets whether the mesh casts shadows, from the next render
   * @param value - Whether the mesh casts shadows.
   */
  set castShadow(value: boolean) {
    if (value) this._enablePassBit(RenderPassBit.SHADOW);
    else this._disablePassBit(RenderPassBit.SHADOW);
  }

  /**
   * Adds this mesh to a render pass, whatever its material says
   *
   * {@link BaseMaterial3D#enablePass} for one mesh: the pass draws this mesh from the next render,
   * and other meshes sharing the material don't follow. It undoes this mesh's own `disablePass`
   * for the pass. `'shadow'` is the same as setting `castShadow`.
   * @param name - The pass's `name`, such as `'outline'`.
   * @example
   * ```ts
   * hovered.enablePass('outline');
   * ```
   */
  public enablePass(name: string): void {
    this._enablePassBit(passBitRegistry.getOrAllocate(name));
  }

  /**
   * Takes this mesh out of a render pass, whatever its material says
   *
   * The mesh leaves the pass on the next render, and other meshes sharing the material stay in it.
   * `disablePass('opaque')` draws nothing of the mesh while it still casts its shadow. Only the
   * named pass is left, so a material that later turns `'blend'` brings the mesh into the
   * transparent pass. {@link Mesh3D#enablePass} undoes it. Does nothing for a pass name nothing
   * has used yet.
   * @param name - The pass's `name`, such as `'opaque'`.
   * @example
   * ```ts
   * shadowProxy.disablePass('opaque');
   * ```
   */
  public disablePass(name: string): void {
    const bit = passBitRegistry.get(name);
    if (bit !== undefined) this._disablePassBit(bit);
  }

  private _enablePassBit(bit: number): void {
    if (this._enabledPassBits & bit) return;
    this._enabledPassBits |= bit;
    this._disabledPassBits &= ~bit;
    this._markBatchDirty();
  }

  private _disablePassBit(bit: number): void {
    if (this._disabledPassBits & bit) return;
    this._enabledPassBits &= ~bit;
    this._disabledPassBits |= bit;
    this._queueMeshUpdate();
  }

  /**
   * How this mesh turns to face the camera; see {@link BillboardMode} for the modes
   *
   * Local `+Z` turns to face the viewer, so author a card facing `+Z`; any material works, lit or
   * unlit. A solid mesh keeps its depth and the scale along each axis as it turns, but loses the
   * shear of a non-uniformly scaled parent under a rotation. Its shadow and its culling use the
   * unturned mesh, so geometry off-centre from its origin can be culled while on screen, and meshes
   * with different modes don't share a draw.
   * @example
   * ```ts
   * card.billboardMode = 'cylindrical';
   * ```
   */
  get billboardMode(): BillboardMode {
    return this._billboardMode;
  }

  /**
   * Sets how the mesh turns to face the camera
   * @param value - How to orient the mesh toward the camera, or `'none'` to draw it as authored.
   */
  set billboardMode(value: BillboardMode) {
    if (this._billboardMode === value) return;
    this._billboardMode = value;
    this._markBatchDirty();
  }

  /**
   * The {@link RenderPassBit} flags of the passes that draw this mesh: its material's passes, plus
   * `SHADOW` while it casts shadows, or none while it holds {@link Geometry3D.EMPTY} or
   * {@link BaseMaterial3D.EMPTY}
   *
   * The mesh's own {@link Mesh3D#enablePass} and {@link Mesh3D#disablePass} win over its
   * material's, and a blended or transmissive material casts no shadow.
   * @example
   * ```ts
   * const castsShadow = (mesh.renderPassMask & RenderPassBit.SHADOW) !== 0;
   * ```
   * @advanced
   */
  get renderPassMask(): number {
    const passBit = this._material._passBit;
    const mask = (this._enabledPassBits | passBit) & ~this._disabledPassBits & this._placeholderMask;

    return passBit & (RenderPassBit.TRANSPARENT | RenderPassBit.TRANSMISSION) ? mask & ~RenderPassBit.SHADOW : mask;
  }

  /**
   * This mesh's bounding {@link Sphere} in world space, large enough for morph weights from 0 to 1
   *
   * Cached until the world transform or geometry changes, so reading it often is cheap. It follows
   * {@link Container3D.worldTransform | worldTransform}, so it can be out of date after a change
   * this frame. Dynamic geometry gives an empty sphere (`radius < 0`). The sphere is shared: don't
   * change it, and `clone()` it to keep a copy.
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
      } else if (this._morph && geometry._morphBoundsExpansion > 0) {
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
   * Makes the mesh rebuild its shader and draw state on the next frame
   *
   * Assigning `geometry`, `material` or `billboardMode` does this for you, and so do most material
   * changes; {@link BaseMaterial3D} lists the ones that need this call. Call it too after changing
   * {@link Mesh3D#receiveShadow | receiveShadow}. It doesn't re-read vertex data edited in place;
   * call {@link Geometry3D.unload} for that.
   * @example
   * ```ts
   * mesh.receiveShadow = false;
   * mesh.invalidate();
   * ```
   */
  public invalidate(): void {
    this._markBatchDirty();
  }

  /**
   * Unloads this mesh's geometry now
   *
   * The vertex data stays on the CPU, so the next frame that draws the mesh uploads it again.
   * Remove the mesh from the scene first, or that happens straight away. The material is left
   * alone, since it's usually shared: call {@link BaseMaterial3D.unload} for that, or
   * {@link Model3D.unload} to free a model's geometry and textures together.
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

    this._markBatchDirty();
    this._markStoreDirty();
  }

  /** @internal */
  public override _storeWorldTransform(): void {
    const index = this._storeIndex;

    if (index < 0) {
      this._markStoreDirty();

      return;
    }

    const store = this._view3d!._sceneBatch.storeBuffer;
    const worldTransform = this.worldTransform;
    store.writeWorldTransform(index, worldTransform.elements64);
    if (store.writesSpheres) {
      const geometry = this._geometry;
      store.writeBoundingSphere(
        index,
        worldTransform.elements,
        0,
        geometry,
        this._morph ? geometry._morphBoundsExpansion : 0,
      );
    }
  }

  /** @internal */
  public override _storeWorldVisible(): void {
    if (this._worldVisible === this._lastWorldVisible) return;
    this._lastWorldVisible = this._worldVisible;
    const batch = this._view3d!._sceneBatch;
    if (this._storeIndex < 0) this._markStoreDirty();
    else batch.storeBuffer.writeVisibility(this._storeIndex, this._worldVisible);
    batch._visibilityDirtyId++;
  }

  /**
   * Destroys this mesh
   *
   * Geometry and material are often shared, so they stay unless you pass `geometry` or
   * `material`. `texture` then frees the destroyed material's textures, and `textureSource` their
   * sources. The placeholders {@link Geometry3D.EMPTY} and {@link BaseMaterial3D.EMPTY} always
   * stay. The {@link Mesh3D#skeleton | skeleton} is never destroyed here: its {@link Model3D}, or
   * whoever built it, owns it.
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
    this._geometry._meshes.remove(this);
    this._material._meshes.remove(this);
    this._skinnedMeshIndex = -1;
    this._morphedMeshIndex = -1;

    if (resolveDestroy3DFlag(options, 'geometry')) this._destroyGeometry();

    if (resolveDestroy3DFlag(options, 'material')) this._material.destroy(options);

    this._geometry = null!;
    this._material = null!;
  }

  /** Frees the geometry for `destroy`; a subclass that doesn't own its geometry overrides it as a no-op */
  protected _destroyGeometry(): void {
    this._geometry.destroy(true);
  }
}
