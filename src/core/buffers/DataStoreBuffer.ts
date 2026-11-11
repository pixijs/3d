import { Texture, BufferResource, BufferUsage, warn } from 'pixi.js';
import type { BufferImageSource } from 'pixi.js';

import { Buffer3D } from './Buffer3D';
import { alignToDataTextureRows, createDataTextureSource, uploadFloatRange } from './dataTextureLayout';
import { BUFFER_CALL_BYTES, BUFFER_SPAN_FLOOR_BYTES, DirtySlots, TEXTURE_CALL_BYTES } from './DirtySlots';

interface RenderDataBufferOptions<T extends object> {
  stride: number;
  initialSize?: number;
  indexKey: string;
  copier: (
    data: T,
    buffer: Float32Array,
    u32Buffer: Uint32Array,
    fl64Buffer: Float64Array,
    offset: number,
    stride: number,
  ) => void;
}

/** Holds its slot index under the store's `indexKey`, which must start at -1 or `allocate` never gives it a slot */
type SlotOwner = Record<string, number>;

/** @internal */
export class DataStoreBuffer<T extends object = object> {
  public data: Float32Array;
  public u32Data: Uint32Array;
  public fl64Data: Float64Array;

  private _buffer: Buffer3D | null = null;
  private _bufferResource: BufferResource | null = null;

  private readonly _retiredBuffers: Buffer3D[] = [];
  private readonly _retiredTextures: Texture[] = [];

  private _texture: Texture | null = null;
  private _textureSource: BufferImageSource | null = null;

  private _indexKey: string;
  private _freeList!: Uint32Array;
  private _freeCount: number = 0;
  private readonly _stride: number = 0;
  private _count: number = 0;
  private readonly _copier: (
    data: T,
    buffer: Float32Array,
    u32Buffer: Uint32Array,
    fl64Buffer: Float64Array,
    offset: number,
    stride: number,
  ) => void;

  private readonly _dirty: DirtySlots;

  /** Bumped when growth replaces the GPU views, so whatever bound the old ones must bind again */
  public bufferVersion = 0;

  constructor(options: RenderDataBufferOptions<T>) {
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
    this._dirty = new DirtySlots(Math.floor(size / this._stride), this._stride * 4);

    this._copier = options.copier;
  }

  /**
   * WebGPU only: pixi's WebGL buffer system keeps only the last range `update` sends before a bind,
   * so WebGL code reads {@link DataStoreBuffer#texture} and never binds this
   */
  public get buffer(): Buffer3D {
    return (this._buffer ??= new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'RenderDataBuffer',
    }));
  }

  public get bufferResource(): BufferResource {
    return (this._bufferResource ??= new BufferResource({ buffer: this.buffer }));
  }

  /** Growth replaces it, so read it each frame rather than holding it */
  public get texture(): Texture {
    return this._texture || this._initTexture();
  }

  private _initTexture(): Texture {
    if (this._stride % 4 !== 0) {
      warn(
        `DataStoreBuffer: Stride (${this._stride}) is not a multiple of 4. This will cause issues when sampling from a texture.`,
      );
    }

    this._textureSource = createDataTextureSource(this.data);
    this._texture = new Texture({ source: this._textureSource });

    return this._texture;
  }

  public update(): void {
    const dirty = this._dirty;
    if (dirty.isEmpty) return;

    const buffer = this._buffer;
    const source = this._textureSource;

    if (buffer || source) {
      dirty.planRuns();

      const stride = this._stride;
      const runs = dirty.runs;

      if (buffer) {
        if (dirty.runsBeatSpan(BUFFER_CALL_BYTES, BUFFER_SPAN_FLOOR_BYTES)) {
          for (let r = 0; r < dirty.runCount; r++) {
            const start = runs[r * 2] * stride;
            buffer.update((runs[r * 2 + 1] * stride - start) * 4, start * 4);
          }
        } else {
          const start = dirty.min * stride;
          buffer.update(((dirty.max + 1) * stride - start) * 4, start * 4);
        }
      }

      if (source) {
        if (dirty.runsBeatSpan(TEXTURE_CALL_BYTES)) {
          for (let r = 0; r < dirty.runCount; r++) {
            uploadFloatRange(source, runs[r * 2] * stride, runs[r * 2 + 1] * stride);
          }
        } else {
          uploadFloatRange(source, dirty.min * stride, (dirty.max + 1) * stride);
        }
      }
    }

    dirty.clear();
  }

  /** Checks the new slot's end against the array, which is sized in texture rows and can end partway through a slot */
  public allocate(item: T): number {
    const slotOwner = item as SlotOwner;
    let index = slotOwner[this._indexKey];

    if (index < 0) {
      if (this._freeCount > 0) {
        index = this._freeList[--this._freeCount];
      } else {
        if ((this._count + 1) * this._stride > this.data.length) {
          this._expand();
        }
        index = this._count++;
      }

      slotOwner[this._indexKey] = index;
    }

    return index;
  }

  /**
   * Too slow for per-frame use at scale, since the `indexKey` read is megamorphic; writes nothing
   * once the store is destroyed, since items outlive their renderer
   */
  public set(item: T): number {
    if (!this.data) return -1;

    const index = this.allocate(item);
    const stride = this._stride;

    this._copier(item, this.data, this.u32Data, this.fl64Data, index * stride, stride);
    this._dirty.mark(index);

    return index;
  }

  /** Resets the index even once the store is destroyed, so the item can take a slot in the next renderer's store */
  public remove(item: T): void {
    const slotOwner = item as SlotOwner;
    const index = slotOwner[this._indexKey];

    if (index < 0) return;

    slotOwner[this._indexKey] = -1;

    if (!this.data) return;

    if (this._freeCount >= this._freeList.length) {
      const newFreeList = new Uint32Array(this._freeList.length * 2);
      newFreeList.set(this._freeList);
      this._freeList = newFreeList;
    }

    this._freeList[this._freeCount++] = index;
  }

  get stride(): number {
    return this._stride;
  }

  /**
   * Reserves `count` slots for a caller that writes them itself; the block is never freed
   * @param owner - Receives the block's first index under `indexKey`.
   * @param count - Slots to reserve.
   */
  public allocateBlock(owner: SlotOwner, count: number): number {
    const existing = owner[this._indexKey];
    if (existing >= 0) return existing;

    const requiredSize = (this._count + count) * this._stride;
    if (requiredSize > this.data.length) {
      this._expand(requiredSize);
    }

    const baseIndex = this._count;

    owner[this._indexKey] = baseIndex;
    this._count += count;
    this._dirty.markRange(baseIndex, baseIndex + count - 1);

    return baseIndex;
  }

  public markDirty(index: number): void {
    this._dirty.mark(index);
  }

  /** Makes the whole next upload one span, single marks included, so mark scattered slots with {@link markDirty} */
  public markDirtyRange(fromIndex: number, toIndex: number): void {
    this._dirty.markRange(fromIndex, toIndex);
  }

  private _freeRetired(): void {
    for (let i = 0; i < this._retiredBuffers.length; i++) this._retiredBuffers[i].destroy();
    this._retiredBuffers.length = 0;

    for (let i = 0; i < this._retiredTextures.length; i++) this._retiredTextures[i].destroy(true);
    this._retiredTextures.length = 0;
  }

  public unload(): void {
    if (!this.data) return;

    this._buffer?.unload();
    this._textureSource?.unload();
    this._freeRetired();
  }

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
   * Retires the GPU views rather than destroying them, since a view that drew earlier this frame
   * still binds them; `_freeRetired` frees them
   */
  protected _expand(minSize?: number): void {
    let newSize = this.data.length * 2;
    if (minSize !== undefined && newSize < minSize) newSize = minSize;

    newSize = alignToDataTextureRows(newSize);

    const newData = new Float32Array(newSize);
    newData.set(this.data);
    this.data = newData;
    this.u32Data = new Uint32Array(this.data.buffer);
    this.fl64Data = new Float64Array(this.data.buffer);

    const newSlotCapacity = newSize / this._stride;
    this._dirty.grow(Math.floor(newSlotCapacity));
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
