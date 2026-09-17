import { GlobalResourceRegistry } from 'pixi.js';

import type { Geometry3D } from './Geometry3D';
import { GeometryAtlas } from './GeometryAtlas';
import type { GeometryAllocation } from './GeometryAtlas';

/**
 * Options for {@link GeometryAtlasPool}
 * @internal
 */
interface GeometryAtlasPoolOptions {
  /**
   * Bake `baseVertex` into index values when packing
   *
   * WebGL 2 has no `baseVertex` draw param, so it packs `true`; WebGPU passes
   * `baseVertex` at draw time, so it packs `false`.
   */
  rebaseIndices: boolean;
}

/** Process-wide pools, one per index-packing convention. See {@link GeometryAtlasPool.from} */
const sharedPools: Record<string, GeometryAtlasPool> = Object.create(null);

/**
 * Pools the {@link GeometryAtlas} instances for one index-packing convention, keyed by attribute
 * layout, and owns their allocation and per-frame upload
 *
 * Reach it through {@link GeometryAtlasPool.from} rather than constructing one.
 *
 * Geometries with the same {@link Geometry3D#attributeKey} pack into one atlas so
 * their draws share buffers. Both backends draw {@link GeometryAtlas#geometry}; how they
 * reach a member's vertices differs (WebGL rebases indices into the atlas, WebGPU passes a
 * `baseVertex` draw param) and lives in the pipes.
 * @internal
 */
export class GeometryAtlasPool {
  private _atlases: Record<string, GeometryAtlas> = Object.create(null);
  private readonly _rebaseIndices: boolean;
  private _bufferVersion = 0;

  constructor(options: GeometryAtlasPoolOptions) {
    this._rebaseIndices = options.rebaseIndices;
  }

  /**
   * The process-wide pool for an index-packing convention, built on first use
   *
   * Shared rather than per-renderer because packed geometry outlives any one renderer.
   * {@link Geometry3D} holds a single `_geometryAtlasAllocation`, so the same geometry drawn by
   * two renderers with separate pools gets re-cut by each in turn, orphaning its slot in the
   * other. One pool per convention is what keeps that field meaningful.
   *
   * Keyed on `rebaseIndices` because it changes the packed bytes, not just how they are drawn:
   * WebGL bakes `baseVertex` into the index values, WebGPU leaves them geometry-local. The two
   * can never share an index buffer.
   *
   * No renderer owns it, so none tears it down on destroy — Pixi builds its own GPU-side buffers
   * per renderer from the same descriptors, and a renderer created after another was destroyed
   * reuses the packing as-is. It registers with pixi's {@link GlobalResourceRegistry} instead, so
   * the explicit `renderer.destroy(true)` / `{ releaseGlobalResources: true }` teardown clears it
   * alongside pixi's own shared pools. Ordinary teardown leaves it be, and routine reclamation
   * stays per geometry via {@link Geometry3D#destroy}.
   * @param options - Which index-packing convention the pool serves
   * @returns The shared pool for that convention
   */
  public static from(options: GeometryAtlasPoolOptions): GeometryAtlasPool {
    const key = options.rebaseIndices ? 'rebased' : 'geometryLocal';
    let pool = sharedPools[key];

    if (!pool) {
      pool = new GeometryAtlasPool(options);
      sharedPools[key] = pool;
      GlobalResourceRegistry.register(pool);
    }

    return pool;
  }

  /**
   * Monotonic version, bumped whenever packed geometry stops being where cached draw state
   * expects it
   *
   * That is an {@link GeometryAtlasPool#allocate} that grows or compacts an atlas's buffers. A
   * {@link GeometryAtlas#remove} never moves it: the vacated range keeps its bytes until the
   * compaction that reclaims it, and that compaction is what versions. A View3D snapshots it per
   * render and rebuilds its draw programs when it moves.
   */
  get bufferVersion(): number {
    return this._bufferVersion;
  }

  /**
   * Allocates (or reuses) a slot for `geometry`, creating the atlas for its
   * attribute layout on first use
   *
   * Bumps {@link GeometryAtlasPool#bufferVersion} when the insert grows or compacts the
   * atlas.
   *
   * The idempotency chokepoint: a geometry already packed into *this pool's* atlas returns its
   * existing allocation with no growth, and one left over from another pool's atlas is re-cut
   * here. Callers must route through this rather than memoise the allocation themselves; see
   * {@link GeometryAtlasPool.from}.
   * @param geometry - The geometry to pack into its layout's atlas
   * @returns The allocation describing where the data lives in the merged buffers
   */
  public allocate(geometry: Geometry3D): GeometryAllocation {
    const key = geometry.attributeKey;
    let atlas = this._atlases[key];

    const existing = geometry._geometryAtlasAllocation;
    if (existing && existing.atlas === atlas) return existing;

    if (!atlas) {
      atlas = new GeometryAtlas({ referenceGeometry: geometry, rebaseIndices: this._rebaseIndices });
      this._atlases[key] = atlas;
    }

    const atlasVersion = atlas._bufferVersion;
    const allocation = atlas.add(geometry);
    if (atlas._bufferVersion !== atlasVersion) this._bufferVersion++;

    return allocation;
  }

  /** Flushes every atlas's dirty vertex/index ranges to the GPU; call once per View3D render */
  public update(): void {
    for (const key in this._atlases) this._atlases[key].update();
  }

  /**
   * Destroys every atlas and drops the pool's contents, leaving it reusable
   *
   * The next {@link GeometryAtlasPool#allocate} rebuilds the atlas it needs. Named for pixi's
   * `Cleanable` contract, which is what lets the pool register with
   * {@link GlobalResourceRegistry}. Not called on renderer teardown; see
   * {@link GeometryAtlasPool.from}.
   */
  public clear(): void {
    for (const key in this._atlases) this._atlases[key].destroy();
    this._atlases = Object.create(null);
  }
}
