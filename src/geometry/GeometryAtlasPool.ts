import { GlobalResourceRegistry, warn } from 'pixi.js';
import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';

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
  /** Per attribute layout; a layout opens another atlas only when the others would pass `maxBufferBytes` */
  private _atlases: Record<string, GeometryAtlas[]> = Object.create(null);
  private readonly _rebaseIndices: boolean;
  private _bufferVersion = 0;
  private _maxBufferBytes = Infinity;

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

  /** Only ever lowers, since renderers sharing the pool may have different devices */
  get maxBufferBytes(): number {
    return this._maxBufferBytes;
  }

  set maxBufferBytes(bytes: number) {
    this._maxBufferBytes = Math.min(this._maxBufferBytes, bytes);
    for (const key in this._atlases) {
      for (const atlas of this._atlases[key]) atlas.maxBufferBytes = this._maxBufferBytes;
    }
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
    const atlases = (this._atlases[key] ??= []);

    const existing = geometry._geometryAtlasAllocation;
    if (existing && atlases.includes(existing.atlas)) return existing;

    let atlas = atlases.find((a) => a.fits(geometry));

    if (!atlas) {
      atlas = new GeometryAtlas({
        referenceGeometry: geometry,
        rebaseIndices: this._rebaseIndices,
        maxBufferBytes: this._maxBufferBytes,
      });
      atlases.push(atlas);

      if (!atlas.fits(geometry)) {
        warn(
          `GeometryAtlasPool: a geometry of ${geometry.vertexCount} vertices passes the device's maxBufferSize ` +
            `(${this._maxBufferBytes} bytes) once interleaved, so every frame that draws it fails. ` +
            `Make it dynamic to draw it from its own buffers.`,
        );
      }
    }

    const atlasVersion = atlas._bufferVersion;
    const allocation = atlas.add(geometry);
    if (atlas._bufferVersion !== atlasVersion) this._bufferVersion++;

    return allocation;
  }

  /** Brings the renderer's copy of every atlas up to date, so call it after this frame's `allocate` calls and before drawing */
  public update(renderer: WebGLRenderer | WebGPURenderer): void {
    for (const key in this._atlases) {
      for (const atlas of this._atlases[key]) atlas.update(renderer);
    }
  }

  /** Call it when a renderer's context is lost or the renderer goes, since the pool outlives both */
  public invalidateUploads(rendererUid: number): void {
    for (const key in this._atlases) {
      for (const atlas of this._atlases[key]) atlas.invalidateUploads(rendererUid);
    }
  }

  /** Destroys every atlas, leaving the pool usable; named for pixi's `Cleanable`, which the registry calls */
  public clear(): void {
    for (const key in this._atlases) {
      for (const atlas of this._atlases[key]) atlas.destroy();
    }
    this._atlases = Object.create(null);
  }
}
