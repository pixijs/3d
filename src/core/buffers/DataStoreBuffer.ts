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

const noCopy = (): void => {};

const LONG_RUN_LANES = 1024;

/**
 * Copies `u32` lanes, since a float copy may change a NaN's bits and an index lane can hold any. A long run takes
 * `set`, several times faster than the loop for one view's allocation, so a frame allocates one per long run only
 */
function copyLanes(from: Uint32Array, to: Uint32Array, start: number, end: number): void {
  if (end - start >= LONG_RUN_LANES) {
    to.set(from.subarray(start, end), start);
    return;
  }
  for (let i = start; i < end; i++) to[i] = from[i];
}

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

  private _previous: DataStoreBuffer<T> | null = null;

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

  /**
   * `null` while {@link keepPrevious} is off. Its GPU views copy its data on first bind, after `update` copied this
   * render's rows in, so the render that makes them reads no change
   */
  public get previous(): DataStoreBuffer<T> | null {
    return this._previous;
  }

  /**
   * Stopping unloads the copy rather than destroying it, since the view's bind group may hold it until the next draw
   * re-points the slot, and pixi warns when a bound resource dies
   * @returns Whether it started or stopped, which replaces what a recorded draw bound
   */
  public keepPrevious(keep: boolean): boolean {
    if (keep === (this._previous !== null) || !this.data) return false;

    if (keep) {
      const previous = new DataStoreBuffer<T>({
        stride: this._stride,
        initialSize: Math.ceil(this.data.length / this._stride),
        indexKey: this._indexKey,
        copier: noCopy,
      });
      copyLanes(this.u32Data, previous.u32Data, 0, this.u32Data.length);
      this._previous = previous;
    } else {
      this._previous!.unload();
      this._previous = null;
    }

    return true;
  }

  /** {@link previous} uploads the last update's rows before this update's rows overwrite its data */
  public update(): void {
    const dirty = this._dirty;
    const previous = this._previous;
    previous?.update();
    if (dirty.isEmpty) return;

    const buffer = this._buffer;
    const source = this._textureSource;

    if (buffer || source || previous) {
      dirty.planRuns();

      const stride = this._stride;
      const runs = dirty.runs;

      if (previous) this._copyDirtyInto(previous);

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

  /** Marks {@link previous}'s copies for its next upload, a render later than this store's own */
  private _copyDirtyInto(previous: DataStoreBuffer<T>): void {
    const dirty = this._dirty;
    const stride = this._stride;

    if (dirty.spanOnly) {
      copyLanes(this.u32Data, previous.u32Data, dirty.min * stride, (dirty.max + 1) * stride);
      previous.markDirtyRange(dirty.min, dirty.max);

      return;
    }

    const runs = dirty.runs;
    for (let r = 0; r < dirty.runCount; r++) {
      const start = runs[r * 2];
      const end = runs[r * 2 + 1];
      copyLanes(this.u32Data, previous.u32Data, start * stride, end * stride);
      for (let slot = start; slot < end; slot++) previous.markDirty(slot);
    }
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

    const previous = this._previous;
    const newRow = previous !== null && (item as SlotOwner)[this._indexKey] < 0;
    const index = this.allocate(item);
    const stride = this._stride;

    this._copier(item, this.data, this.u32Data, this.fl64Data, index * stride, stride);
    this._dirty.mark(index);

    if (newRow) {
      copyLanes(this.u32Data, previous.u32Data, index * stride, (index + 1) * stride);
      previous.markDirty(index);
    }

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
    this._previous?.unload();
  }

  public destroy(): void {
    if (!this.data) return;

    this._bufferResource?.destroy(false);
    this._buffer?.destroy();

    this._freeRetired();

    this._texture?.destroy(true);

    this._previous?.destroy();
    this._previous = null;

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

    const previous = this._previous;
    if (previous && previous.data.length < newSize) previous._expand(newSize);
  }
}
