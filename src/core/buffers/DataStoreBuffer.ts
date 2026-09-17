import { BufferImageSource, BufferResource, BufferUsage, Texture } from 'pixi.js';

import { Buffer3D } from './Buffer3D';
import { alignToDataTextureRows, dataTextureSize } from './dataTextureLayout';

/**
 * Options for `DataStoreBuffer`
 * @internal
 */
interface RenderDataBufferOptions {
  /** Floats per slot */
  stride: number;
  /** Initial capacity in slots; default 100 */
  initialSize?: number;
  /** Property name on the item where the buffer index is stored (e.g. '_storeIndex') */
  indexKey: string;
  /** Writes one item's data into the buffer views at `offset`; called by `set` */
  copier: (
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    buffer: Float32Array,
    u32Buffer: Uint32Array,
    fl64Buffer: Float64Array,
    offset: number,
    stride: number,
  ) => void;
}

/**
 * Persistent slot store of per-item GPU data with stable item→slot mapping
 *
 * Each item claims a slot (index written back onto the item via `indexKey`)
 * that it keeps until removed; freed slots recycle through a free list.
 * Uploads use min/max dirty-range tracking so only the changed span moves to
 * the GPU. WebGPU binds the storage buffer; WebGL binds the lazily-created
 * rgba32float data-texture view over the same backing array.
 * @internal
 */
export class DataStoreBuffer {
  /** Backing CPU array (f32 view) */
  public data: Float32Array;
  /** `u32` view over the same backing array */
  public u32Data: Uint32Array;
  /** `f64` view over the same backing array */
  public fl64Data: Float64Array;

  /** GPU buffer (storage) */
  public buffer: Buffer3D;
  /** Bindable resource for shaders */
  public bufferResource: BufferResource;

  /**
   * Buffers orphaned by `_expand` growth. They are {@link Buffer3D}s, so the
   * renderer GC never reclaims them — retain each until `_freeRetired` frees
   * it on `unload` or `destroy`.
   */
  private readonly _retiredBuffers: Buffer3D[] = [];

  private _texture: Texture | null = null;
  private _textureSource: BufferImageSource | null = null;

  private _indexKey: string;
  private _freeList!: Uint32Array;
  private _freeCount: number = 0;
  private readonly _stride: number;
  private _count: number = 0;
  private readonly _copier: (
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    buffer: Float32Array,
    u32Buffer: Uint32Array,
    fl64Buffer: Float64Array,
    offset: number,
    stride: number,
  ) => void;

  private _minDirty: number = Infinity;
  private _maxDirty: number = -Infinity;
  /**
   * Incremented whenever the backing buffer is reallocated in `_expand`
   *
   * Consumers watermark it and invalidate cached state that bound the old
   * buffer — per-batch stores in `updateView3DScene`, shared stores via
   * `detectSharedCacheInvalidation`.
   */
  public bufferVersion = 0;

  constructor(options: RenderDataBufferOptions) {
    this._stride = options.stride;
    this._indexKey = options.indexKey;

    const initialSize = options.initialSize || 100;
    let size = initialSize * this._stride;
    if (size % 4 !== 0) size += 4 - (size % 4);
    // The WebGL texture view spans whole rows, so a store that starts out past one row has
    // to fill them or the texture claims texels the array doesn't have. `_expand` keeps
    // this true from here on.
    size = alignToDataTextureRows(size);

    this.data = new Float32Array(size);
    this.u32Data = new Uint32Array(this.data.buffer);
    this.fl64Data = new Float64Array(this.data.buffer);
    this._freeList = new Uint32Array(initialSize);

    this._copier = options.copier;

    this.buffer = new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'RenderDataBuffer',
    });

    this.bufferResource = new BufferResource({ buffer: this.buffer });
  }

  /** A texture view of the store for WebGL shaders */
  public get texture(): Texture {
    return this._texture || this._initTexture();
  }

  private _initTexture(): Texture {
    if (this._stride % 4 !== 0) {
      // oxlint-disable-next-line no-console
      console.warn(
        `DataStoreBuffer: Stride (${this._stride}) is not a multiple of 4. This will cause issues when sampling from a texture.`,
      );
    }

    const { width, height } = dataTextureSize(this.data.length);

    this._textureSource = new BufferImageSource({
      resource: this.data,
      width,
      height,
      format: 'rgba32float',
      scaleMode: 'nearest',
      alphaMode: 'no-premultiply-alpha',
    });

    this._texture = new Texture({
      source: this._textureSource,
    });

    return this._texture;
  }

  /** Uploads changes to the GPU, using min/max dirty tracking to upload only the changed range */
  public update(): void {
    if (this._minDirty > this._maxDirty) return;

    const offsetInBytes = this._minDirty * this._stride * 4;
    const sizeInBytes = (this._maxDirty - this._minDirty + 1) * this._stride * 4;

    this.buffer.update(sizeInBytes, offsetInBytes);

    if (this._textureSource) {
      // The WebGL data-texture view re-uploads whole — BufferImageSource has
      // no partial update.
      this._textureSource.update();
    }

    this._minDirty = Infinity;
    this._maxDirty = -Infinity;
  }

  /**
   * Allocates a slot for an item and writes the index back via the dynamic indexKey property
   *
   * Reuses a freed slot when one exists, otherwise appends (expanding as
   * needed). Copies no data — pair with `set()` or a queued upload for the
   * contents. No-op when the item already holds a slot.
   * @param item - The item to allocate for; its indexKey property receives the slot index.
   * @returns The item's slot index.
   */
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  public allocate(item: any): number {
    let index: number = item[this._indexKey];

    if (index < 0) {
      if (this._freeCount > 0) {
        index = this._freeList[--this._freeCount];
      } else {
        // Compare the slot's end against capacity. `_expand` aligns to whole texture
        // rows, so for strides that don't
        // divide the row evenly (e.g. Mesh3DDataStoreBuffer stride 20) the
        // last slot would overflow `data.length` and the trailing floats
        // would be silently dropped by the typed-array bounds check.
        if ((this._count + 1) * this._stride > this.data.length) {
          this._expand();
        }
        index = this._count++;
      }

      item[this._indexKey] = index;
    }

    return index;
  }

  /**
   * Allocates (if needed) and copies data for an item via the copier function
   *
   * Reads/writes the stored index via the dynamic indexKey property. That read is one
   * inline cache shared by every store's key, so it is megamorphic (~65 ns per call
   * measured) — fine for the event-driven callers here, wrong for anything per-frame at
   * scale. Hot paths pass the index in instead; see
   * `Mesh3DDataStoreBuffer.writeWorldTransform`.
   * @param item - The item to stage; passed straight to the `copier`.
   * @returns The item's slot index, or -1 once the store is destroyed.
   */
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  public set(item: any): number {
    // Store already torn down (renderer destroyed before the item): nothing
    // left to write, and the item re-mints in a live store on its next use.
    if (!this.buffer) return -1;

    const index = this.allocate(item);
    const stride = this._stride;

    this._copier(item, this.data, this.u32Data, this.fl64Data, index * stride, stride);

    if (index < this._minDirty) this._minDirty = index;
    if (index > this._maxDirty) this._maxDirty = index;

    return index;
  }

  /**
   * Frees an item's slot
   *
   * Reads the index from the item's indexKey property, adds the slot to the
   * free-list, and resets the property to -1.
   * @param item - The item whose slot to release.
   */
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  public remove(item: any): void {
    const index: number = item[this._indexKey];

    if (index < 0) return;

    item[this._indexKey] = -1;

    // Store already torn down (renderer destroyed before the item): the index
    // reset above still lets the item re-mint in a fresh renderer's store;
    // there is no slot left to recycle.
    if (!this.buffer) return;

    if (this._freeCount >= this._freeList.length) {
      const newFreeList = new Uint32Array(this._freeList.length * 2);
      newFreeList.set(this._freeList);
      this._freeList = newFreeList;
    }

    this._freeList[this._freeCount++] = index;
  }

  /** The stride in u32 elements per entry */
  get stride(): number {
    return this._stride;
  }

  /**
   * Reserves a contiguous block of `count` slots for external writers (e.g. Mesh3DBatch)
   *
   * The caller writes directly to the typed arrays at the returned offset. No
   * copier is invoked. Reads/writes the stored base index via the owner's
   * indexKey property.
   * @param owner - The owner object. Its indexKey property holds the base index (-1 if unallocated).
   * @param count - Number of contiguous slots to reserve.
   * @returns The base index of the block (multiply by stride for u32 offset).
   */
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  public allocateBlock(owner: any, count: number): number {
    const existing: number = owner[this._indexKey];
    if (existing >= 0) return existing;

    const requiredSize = (this._count + count) * this._stride;
    if (requiredSize > this.data.length) {
      this._expand(requiredSize);
    }

    const baseIndex = this._count;

    owner[this._indexKey] = baseIndex;
    this._count += count;

    if (baseIndex < this._minDirty) this._minDirty = baseIndex;
    if (baseIndex + count - 1 > this._maxDirty) this._maxDirty = baseIndex + count - 1;

    return baseIndex;
  }

  /**
   * Marks a range of entries as dirty so they upload on the next `update()`
   *
   * Used by external writers (Mesh3DBatch) that write directly to the typed arrays.
   * @param fromIndex - Start index (inclusive).
   * @param toIndex - End index (inclusive).
   */
  public markDirtyRange(fromIndex: number, toIndex: number): void {
    if (fromIndex < this._minDirty) this._minDirty = fromIndex;
    if (toIndex > this._maxDirty) this._maxDirty = toIndex;
  }

  /** Frees buffers orphaned by growth; `unload` and `destroy` call it. Idempotent */
  private _freeRetired(): void {
    for (let i = 0; i < this._retiredBuffers.length; i++) this._retiredBuffers[i].destroy();
    this._retiredBuffers.length = 0;
  }

  /**
   * Frees the GPU copies of the store — the buffer, the lazily-created WebGL
   * data-texture, and everything growth retired — while keeping the CPU arrays
   *
   * Both are re-created from `data` on the next fetch, so the revival needs no
   * dirty-marking. Idempotent.
   */
  public unload(): void {
    if (!this.buffer) return;

    this.buffer.unload();
    this._textureSource?.unload();
    this._freeRetired();
  }

  /**
   * Releases every owned GPU resource and drops the backing typed arrays
   *
   * Covers the exclusively-owned GPU buffer, the lazily-created WebGL
   * data-texture (if any), and every buffer retired by growth. Idempotent — a
   * second call is a no-op.
   */
  public destroy(): void {
    if (!this.buffer) return;

    // Free the BufferResource first (destroyBuffer:false) so its bound bind
    // groups react to its change before the Buffer it references is destroyed.
    this.bufferResource.destroy(false);
    this.buffer.destroy();

    this._freeRetired();

    // `_texture.destroy(true)` also frees the owned BufferImageSource.
    this._texture?.destroy(true);

    (this.data as Float32Array | null) = null;
    (this.u32Data as Uint32Array | null) = null;
    (this.fl64Data as Float64Array | null) = null;
    (this.buffer as Buffer3D | null) = null;
    (this.bufferResource as BufferResource | null) = null;

    (this._freeList as Uint32Array | null) = null;
    this._texture = null;
    this._textureSource = null;
  }

  private _expand(minSize?: number): void {
    let newSize = this.data.length * 2;
    if (minSize !== undefined && newSize < minSize) newSize = minSize;

    // Keep the array a whole number of texture rows so it matches the texture dimensions
    // exactly.
    newSize = alignToDataTextureRows(newSize);

    const newData = new Float32Array(newSize);
    newData.set(this.data);
    this.data = newData;
    this.u32Data = new Uint32Array(this.data.buffer);
    this.fl64Data = new Float64Array(this.data.buffer);

    const newSlotCapacity = newSize / this._stride;
    if (newSlotCapacity > this._freeList.length) {
      const newFreeList = new Uint32Array(newSlotCapacity);
      newFreeList.set(this._freeList);
      this._freeList = newFreeList;
    }

    this._retiredBuffers.push(this.buffer);

    // Create a NEW Buffer so the old GPU buffer stays alive for in-flight
    // render bundles recorded earlier in this frame by other View3D instances.
    this.buffer = new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'RenderDataBuffer',
    });
    this.bufferResource = new BufferResource({ buffer: this.buffer });
    this.bufferVersion++;

    // All existing data must be uploaded to the new GPU buffer.
    this._minDirty = 0;
    this._maxDirty = this._count - 1;

    if (this._textureSource) {
      const { width, height } = dataTextureSize(this.data.length);

      this._textureSource.resource = this.data;

      if (this._textureSource.width !== width || this._textureSource.height !== height) {
        this._textureSource.resize(width, height);
      }
      this._textureSource.update();
    }
  }
}
