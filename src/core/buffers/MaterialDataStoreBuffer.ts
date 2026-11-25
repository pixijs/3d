import { BufferUsage, RendererType, Texture } from 'pixi.js';
import type { BufferImageSource, BufferResource } from 'pixi.js';

import type { BaseMaterial3D, MaterialUploadQueue } from '../../materials/BaseMaterial3D';
import { Buffer3D } from './Buffer3D';
import {
  alignToDataTextureRows,
  createDataTextureSource,
  uploadFloatRange,
  WORDS_PER_TEXEL,
} from './dataTextureLayout';
import { BUFFER_CALL_BYTES, BUFFER_SPAN_FLOOR_BYTES, TEXTURE_CALL_BYTES } from './DirtySlots';
import { MaterialRowResource } from './MaterialRowResource';

const INITIAL_TEXELS = 1024;
const BYTES_PER_TEXEL = WORDS_PER_TEXEL * 4;

function leastCommonMultiple(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];

  return (a / x) * b;
}

interface MaterialDataStoreBufferOptions {
  alignment: number;
  rendererType: RendererType;
}

/**
 * Places start on the device's uniform offset alignment rather than the next texel, since a direct
 * draw binds its material's place as a uniform range
 * @internal
 */
export class MaterialDataStoreBuffer implements MaterialUploadQueue {
  public data: Float32Array;
  private readonly _retiredTextures: Texture[] = [];

  /** Growth replaces it, so read it each frame rather than holding it */
  public texture: Texture<BufferImageSource>;

  /** The uniform view, `null` until a {@link uniformResource} call and again after growth retires it */
  private _buffer: Buffer3D | null = null;

  private readonly _retiredBuffers: Buffer3D[] = [];
  private readonly _alignment: number = 0;
  private readonly _texelsPerUnit: number = 0;
  private _end = 0;
  private readonly _freePlaces = new Map<number, number[]>();

  /** Live in the first `_dirtyCount` entries; the drain nulls each, so a queued material can be collected */
  private readonly _dirtyQueue: (BaseMaterial3D | null)[] = [];
  private _dirtyCount = 0;
  private _ranges = new Uint32Array(64);

  /** Bumped when growth replaces the GPU views, so whatever bound the old ones must bind again */
  public bufferVersion = 0;

  /** Per-call fee for uniform writes; `Infinity` on WebGL, where pixi uploads only the last range set before a bind */
  private readonly _bufferCallBytes: number = 0;

  constructor(options: MaterialDataStoreBufferOptions) {
    const { alignment, rendererType } = options;
    if (!(alignment > 0)) {
      throw new Error(
        `MaterialDataStoreBuffer: renderer.limits.minUniformBufferOffsetAlignment is ${alignment}; ` +
          'the limits system fills it in after the renderer has a context',
      );
    }

    this._alignment = leastCommonMultiple(alignment, BYTES_PER_TEXEL);
    this._texelsPerUnit = this._alignment / BYTES_PER_TEXEL;
    this._bufferCallBytes = rendererType === RendererType.WEBGPU ? BUFFER_CALL_BYTES : Infinity;
    this.data = new Float32Array(alignToDataTextureRows(INITIAL_TEXELS * WORDS_PER_TEXEL));
    this.texture = new Texture({ source: createDataTextureSource(this.data) });
  }

  /**
   * Does nothing once the store is destroyed, so a late `material.update()` can't leave the material
   * flagged as queued on a store that never drains
   */
  public enqueueDirty(material: BaseMaterial3D): void {
    if (!this.data || material._storeQueued) return;
    material._storeQueued = true;
    this._dirtyQueue[this._dirtyCount++] = material;
  }

  /**
   * Places the material at once, since callers write its index into mesh rows in the same walk;
   * another store's place is handed back, as in `GeometryDataStoreBuffer.set`
   */
  public register(material: BaseMaterial3D): void {
    const old = material._uploadQueue;
    if (old === this && material._materialIndex !== -1) return;

    if (old && old !== this) old.remove(material);
    material._uploadQueue = this;
    material._storeQueued = false;
    this._allocate(material);
    this.enqueueDirty(material);
  }

  /**
   * Reads the material's data for the place's length, so call it before the data is dropped; once the
   * store is destroyed it only resets the index
   */
  public remove(material: BaseMaterial3D): void {
    const index = material._materialIndex;
    if (index < 0) return;

    material._materialIndex = -1;

    if (!this.data) return;

    const units = this._units(material);
    let free = this._freePlaces.get(units);
    if (!free) this._freePlaces.set(units, (free = []));
    free.push(index);
  }

  /** Cached on the material, and replaced once growth or a re-registration moves its place */
  public uniformResource(material: BaseMaterial3D): BufferResource {
    const buffer = (this._buffer ??= new Buffer3D({
      data: this.data,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
      label: 'MaterialStore',
    }));
    const offset = material._materialIndex * BYTES_PER_TEXEL;

    let resource = material._uniformResource;
    if (resource && resource.buffer === buffer && resource.offset === offset) return resource;

    resource?.destroy(false);
    resource = material._uniformResource = new MaterialRowResource({
      buffer,
      offset,
      size: this._units(material) * this._alignment,
    });

    return resource;
  }

  /**
   * Resets the count before the drain, so a throw can't leave it counting nulled entries; skips a
   * material whose `_uploadQueue` is no longer this store
   */
  public update(): void {
    const queue = this._dirtyQueue;
    const count = this._dirtyCount;
    if (count === 0) return;

    this._dirtyCount = 0;

    const data = this.data;
    let rangeCount = 0;
    let floats = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < count; i++) {
      const material = queue[i]!;
      queue[i] = null;
      if (material._uploadQueue !== this) continue;
      material._storeQueued = false;

      const f32 = material.data._f32;
      const start = material._materialIndex * WORDS_PER_TEXEL;
      const end = start + f32.length;
      data.set(f32, start);

      if (rangeCount * 2 + 2 > this._ranges.length) {
        const ranges = new Uint32Array(this._ranges.length * 2);
        ranges.set(this._ranges);
        this._ranges = ranges;
      }
      this._ranges[rangeCount * 2] = start;
      this._ranges[rangeCount * 2 + 1] = end;
      rangeCount++;
      floats += end - start;
      if (start < min) min = start;
      if (end > max) max = end;
    }

    if (rangeCount === 0) return;

    const ranges = this._ranges;
    const spanBytes = (max - min) * 4;
    const rangeBytes = floats * 4;

    const source = this.texture.source;
    if (rangeCount * TEXTURE_CALL_BYTES + rangeBytes < spanBytes) {
      for (let r = 0; r < rangeCount; r++) {
        uploadFloatRange(source, ranges[r * 2], ranges[r * 2 + 1]);
      }
    } else {
      uploadFloatRange(source, min, max);
    }

    const buffer = this._buffer;
    if (!buffer) return;

    if (spanBytes >= BUFFER_SPAN_FLOOR_BYTES && rangeCount * this._bufferCallBytes + rangeBytes < spanBytes) {
      for (let r = 0; r < rangeCount; r++) {
        const start = ranges[r * 2];
        buffer.update((ranges[r * 2 + 1] - start) * 4, start * 4);
      }
    } else {
      buffer.update(spanBytes, min * 4);
    }
  }

  public destroy(): void {
    if (!this.data) return;

    this._buffer?.destroy();
    for (let i = 0; i < this._retiredBuffers.length; i++) this._retiredBuffers[i].destroy();

    for (let i = 0; i < this._retiredTextures.length; i++) this._retiredTextures[i].destroy(true);

    this.texture.destroy(true);

    (this.data as Float32Array | null) = null;
    this._buffer = null;
    (this._retiredBuffers as Buffer3D[] | null) = null;
    (this._retiredTextures as Texture[] | null) = null;
    (this.texture as Texture<BufferImageSource> | null) = null;

    (this._freePlaces as Map<number, number[]> | null) = null;
    (this._dirtyQueue as (BaseMaterial3D | null)[] | null) = null;
    this._dirtyCount = 0;
    (this._ranges as Uint32Array | null) = null;
  }

  private _units(material: BaseMaterial3D): number {
    return Math.ceil(material.data._f32.byteLength / this._alignment);
  }

  private _allocate(material: BaseMaterial3D): void {
    if (material._materialIndex >= 0) return;

    const units = this._units(material);
    let index = this._freePlaces.get(units)?.pop();

    if (index === undefined) {
      const endBytes = (this._end + units) * this._alignment;
      if (endBytes > this.data.byteLength) this._expand(endBytes / 4);

      index = this._end * this._texelsPerUnit;
      this._end += units;
    }

    material._materialIndex = index;
  }

  /**
   * Retires the GPU views rather than destroying them, since a view that drew earlier this frame
   * still binds them; `destroy` frees them
   */
  private _expand(minSize: number): void {
    let newSize = this.data.length * 2;
    if (newSize < minSize) newSize = minSize;

    newSize = alignToDataTextureRows(newSize);

    const newData = new Float32Array(newSize);
    newData.set(this.data);
    this.data = newData;

    this._retiredTextures.push(this.texture);
    this.texture = new Texture({ source: createDataTextureSource(this.data) });

    if (this._buffer) {
      this._retiredBuffers.push(this._buffer);
      this._buffer = null;
    }

    this.bufferVersion++;
  }
}
