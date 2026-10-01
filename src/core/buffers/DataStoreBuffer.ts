import { BufferImageSource, BufferResource, BufferUsage, Texture } from 'pixi.js';

import { Buffer3D } from './Buffer3D';
import { alignToDataTextureRows, dataTextureSize, uploadFloatRange } from './dataTextureLayout';

/**
 * Options for `DataStoreBuffer`
 * @internal
 */
interface RenderDataBufferOptions {
  /** Floats per slot */
  stride: number;
  /** Initial capacity in slots; defaults to 100 */
  initialSize?: number;
  /** Name of the property on each item that holds its slot index, such as `'_storeIndex'` */
  indexKey: string;
  /** Writes one item's data into the buffer views at `offset`; called by `set` */
  copier: (
    data: any,
    buffer: Float32Array,
    u32Buffer: Uint32Array,
    fl64Buffer: Float64Array,
    offset: number,
    stride: number,
  ) => void;
}

/**
 * A store of per-item GPU data where each item keeps its slot until it's removed
 *
 * An item's slot index is written onto the item under `indexKey`, and freed slots are reused. The
 * store tracks the lowest and highest changed slot, so an upload moves only that span.
 *
 * It has two GPU views over one CPU array, each made on first read, so a store only makes what
 * something binds: a storage buffer for WebGPU, and an `rgba32uint` data texture for WebGL and for
 * the WebGPU material store. Rows mix integer and float lanes, and an integer texture hands the
 * shader every lane's exact bits, floats included. A float texture wouldn't: a small integer's bit
 * pattern is a denormal float, which a texture fetch may flush to zero.
 * @internal
 */
export class DataStoreBuffer {
  /**
   * The CPU array, as floats
   *
   * Sized to whole data-texture rows once it's past one row, so the texture view never claims
   * texels past its end.
   */
  public data: Float32Array;
  /** `u32` view over the same backing array */
  public u32Data: Uint32Array;
  /** `f64` view over the same backing array */
  public fl64Data: Float64Array;

  private _buffer: Buffer3D | null = null;
  private _bufferResource: BufferResource | null = null;

  /** Buffers `_expand` replaced; `_expand` says why they're kept, and `_freeRetired` frees them */
  private readonly _retiredBuffers: Buffer3D[] = [];

  /** Data textures `_expand` replaced, kept like `_retiredBuffers` */
  private readonly _retiredTextures: Texture[] = [];

  private _texture: Texture | null = null;
  private _textureSource: BufferImageSource | null = null;

  private _indexKey: string;
  private _freeList!: Uint32Array;
  private _freeCount: number = 0;
  private readonly _stride: number = 0;
  private _count: number = 0;
  private readonly _copier: (
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
   * Incremented each time `_expand` replaces the buffer and the texture view
   *
   * Consumers watermark it and invalidate cached state that bound the old buffer or texture.
   * Per-batch stores do this in `updateView3DScene`, shared stores through
   * `detectSharedCacheInvalidation`.
   */
  public bufferVersion = 0;

  constructor(options: RenderDataBufferOptions) {
    this._stride = options.stride;
    this._indexKey = options.indexKey;

    const initialSize = options.initialSize || 100;
    let size = initialSize * this._stride;
    if (size % 4 !== 0) size += 4 - (size % 4);
    size = alignToDataTextureRows(size);

    this.data = new Float32Array(size);
    this.u32Data = new Uint32Array(this.data.buffer);
    this.fl64Data = new Float64Array(this.data.buffer);
    this._freeList = new Uint32Array(initialSize);

    this._copier = options.copier;
  }

  /** The store as a storage buffer, created on first read */
  public get buffer(): Buffer3D {
    return (this._buffer ??= new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'RenderDataBuffer',
    }));
  }

  /** Bindable resource over {@link DataStoreBuffer#buffer} */
  public get bufferResource(): BufferResource {
    return (this._bufferResource ??= new BufferResource({ buffer: this.buffer }));
  }

  /**
   * An `rgba32uint` data-texture view of the store, created on first read
   *
   * Growth replaces it with a bigger one, so read it each frame rather than holding on to it.
   */
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
      resource: this.u32Data,
      width,
      height,
      format: 'rgba32uint',
      scaleMode: 'nearest',
      alphaMode: 'no-premultiply-alpha',
    });

    this._texture = new Texture({
      source: this._textureSource,
    });

    return this._texture;
  }

  /** Uploads the changed span of slots to whichever GPU views exist */
  public update(): void {
    if (this._minDirty > this._maxDirty) return;

    const start = this._minDirty * this._stride;
    const end = (this._maxDirty + 1) * this._stride;

    this._buffer?.update((end - start) * 4, start * 4);
    if (this._textureSource) uploadFloatRange(this._textureSource, start, end);

    this._minDirty = Infinity;
    this._maxDirty = -Infinity;
  }

  /**
   * Gives an item a slot and writes the index onto it under `indexKey`
   *
   * Reuses a freed slot when there is one, otherwise appends, growing as needed. Capacity is
   * checked against the new slot's end, since the array is sized in whole texture rows rather than
   * whole slots: a stride that doesn't divide a row, such as the mesh store's 24, leaves a partial
   * slot at the end. Copies no data; `set()` does. Does nothing when the item already has a slot.
   * @param item - The item to allocate for; its indexKey property receives the slot index.
   * @returns The item's slot index.
   */
  public allocate(item: any): number {
    let index: number = item[this._indexKey];

    if (index < 0) {
      if (this._freeCount > 0) {
        index = this._freeList[--this._freeCount];
      } else {
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
   * Gives the item a slot if it has none, then copies its data in through the `copier`
   *
   * The index is read under `indexKey`, one inline cache shared by every store's key, so the read is
   * megamorphic, about 65 ns a call when measured. That's fine for the event-driven callers here and
   * wrong for anything per-frame at scale; hot paths pass the index in instead, as
   * `Mesh3DDataStoreBuffer.writeWorldTransform` does.
   *
   * Once the store is destroyed, which happens with its renderer, it writes nothing, and the item
   * gets a slot in a live store the next time one sees it.
   * @param item - The item to stage; passed straight to the `copier`.
   * @returns The item's slot index, or -1 once the store is destroyed.
   */
  public set(item: any): number {
    if (!this.data) return -1;

    const index = this.allocate(item);
    const stride = this._stride;

    this._copier(item, this.data, this.u32Data, this.fl64Data, index * stride, stride);

    if (index < this._minDirty) this._minDirty = index;
    if (index > this._maxDirty) this._maxDirty = index;

    return index;
  }

  /**
   * Frees an item's slot for reuse and resets its index to -1
   *
   * Once the store is destroyed, it only resets the index, which lets the item take a slot in the
   * next renderer's store.
   * @param item - The item whose slot to release.
   */
  public remove(item: any): void {
    const index: number = item[this._indexKey];

    if (index < 0) return;

    item[this._indexKey] = -1;

    if (!this.data) return;

    if (this._freeCount >= this._freeList.length) {
      const newFreeList = new Uint32Array(this._freeList.length * 2);
      newFreeList.set(this._freeList);
      this._freeList = newFreeList;
    }

    this._freeList[this._freeCount++] = index;
  }

  /** 32-bit lanes per slot */
  get stride(): number {
    return this._stride;
  }

  /**
   * Reserves `count` consecutive slots for a caller that writes them itself, such as `Mesh3DBatch`
   *
   * The block's first index is written onto `owner` under `indexKey`; nothing is copied. The block
   * comes from the end of the store and is never freed or reused.
   * @param owner - The owner object. Its indexKey property holds the base index (-1 if unallocated).
   * @param count - Number of contiguous slots to reserve.
   * @returns The base index of the block (multiply by stride for u32 offset).
   */
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
   * Marks a range of slots to upload on the next `update()`, for callers that write the arrays
   * directly
   * @param fromIndex - Start index (inclusive).
   * @param toIndex - End index (inclusive).
   */
  public markDirtyRange(fromIndex: number, toIndex: number): void {
    if (fromIndex < this._minDirty) this._minDirty = fromIndex;
    if (toIndex > this._maxDirty) this._maxDirty = toIndex;
  }

  /** Frees the buffers and data textures orphaned by growth; `unload` and `destroy` call it. Idempotent */
  private _freeRetired(): void {
    for (let i = 0; i < this._retiredBuffers.length; i++) this._retiredBuffers[i].destroy();
    this._retiredBuffers.length = 0;

    for (let i = 0; i < this._retiredTextures.length; i++) this._retiredTextures[i].destroy(true);
    this._retiredTextures.length = 0;
  }

  /**
   * Frees the GPU copies of the store, whichever exist, and keeps the CPU arrays
   *
   * Covers the buffer, the data texture if one exists, and the buffers and textures that growth
   * retired. The buffer and the live texture re-upload from `data` the next time a shader uses
   * them, so nothing needs marking dirty. Idempotent.
   */
  public unload(): void {
    if (!this.data) return;

    this._buffer?.unload();
    this._textureSource?.unload();
    this._freeRetired();
  }

  /**
   * Releases every owned GPU resource and drops the backing typed arrays
   *
   * Covers the buffer and data texture, whichever exist, and every buffer and
   * texture that growth retired. Idempotent, so a second call does nothing.
   */
  public destroy(): void {
    if (!this.data) return;

    this._bufferResource?.destroy(false);
    this._buffer?.destroy();

    this._freeRetired();

    this._texture?.destroy(true);

    (this.data as Float32Array | null) = null;
    (this.u32Data as Uint32Array | null) = null;
    (this.fl64Data as Float64Array | null) = null;
    this._buffer = null;
    this._bufferResource = null;

    (this._freeList as Uint32Array | null) = null;
    this._texture = null;
    this._textureSource = null;
  }

  /**
   * Doubles the array, or grows it to `minSize` floats if that's more, in whole texture rows
   *
   * The GPU views are retired rather than resized: a View3D that drew earlier in the frame
   * recorded the old ones, and they must outlive its submit. The next `buffer` or `texture` read
   * builds new ones over the new array, and each uploads it whole on first use. A retired
   * {@link Buffer3D} is exempt from pixi's GC, so `_freeRetired` frees it on `unload` or `destroy`.
   * @param minSize - The smallest length to grow to, in floats
   */
  private _expand(minSize?: number): void {
    let newSize = this.data.length * 2;
    if (minSize !== undefined && newSize < minSize) newSize = minSize;

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

    if (this._buffer) {
      this._retiredBuffers.push(this._buffer);
      this._buffer = null;
      this._bufferResource = null;
    }

    if (this._texture) {
      this._retiredTextures.push(this._texture);
      this._texture = null;
      this._textureSource = null;
    }

    this.bufferVersion++;
  }
}
