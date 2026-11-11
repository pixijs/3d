import { GlobalResourceRegistry } from 'pixi.js';

import type { Geometry3D } from './Geometry3D';
import { GeometryAtlas } from './GeometryAtlas';
import type { GeometryAllocation } from './GeometryAtlas';

interface GeometryAtlasPoolOptions {
  rebaseIndices: boolean;
}

const sharedPools: Record<string, GeometryAtlasPool> = Object.create(null);

/**
 * Outside tests, reach it through {@link GeometryAtlasPool.from}, which shares one pool per `rebaseIndices` value
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
   * Shared by every renderer with the same `rebaseIndices`, since a geometry holds one allocation that two
   * pools would each re-cut. No renderer destroys it; pixi's `GlobalResourceRegistry` clears it on
   * `renderer.destroy(true)`
   * @returns The shared pool
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

  /** Bumped when an `allocate` grows or compacts an atlas; a removal never bumps it */
  get bufferVersion(): number {
    return this._bufferVersion;
  }

  /**
   * Reuses the geometry's allocation only when it's in this pool's atlas; one left in a destroyed or another
   * pool's atlas is copied in afresh
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

  /** Uploads what this frame's `allocate` calls wrote, so call it after them and before drawing */
  public update(): void {
    for (const key in this._atlases) this._atlases[key].update();
  }

  /** Destroys every atlas, leaving the pool usable; named for pixi's `Cleanable`, which the registry calls */
  public clear(): void {
    for (const key in this._atlases) this._atlases[key].destroy();
    this._atlases = Object.create(null);
  }
}
