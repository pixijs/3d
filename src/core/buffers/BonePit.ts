import { BufferImageSource, BufferResource, BufferUsage, Texture } from 'pixi.js';

import type { Skeleton } from '../../scene/Skeleton';
import { Buffer3D } from './Buffer3D';
import { alignToDataTextureRows, dataTextureSize, uploadFloatRange } from './dataTextureLayout';

/**
 * Floats per bone matrix: the three rows {@link Matrix4.multiplyAffineTo3x4} writes, since the fourth
 * is always `(0, 0, 0, 1)`
 * @internal
 */
export const BONE_MATRIX_FLOATS = 12;

interface BonePitOptions {
  initialBoneCapacity?: number;
}

/**
 * Call `clear`, then `add` for each skeleton drawn, then `update` once, every frame
 * @internal
 */
export class BonePit {
  public data: Float32Array;

  private _buffer: Buffer3D | null = null;
  private _bufferResource: BufferResource | null = null;

  private _boneCount = 0;
  private _tick = 0;

  /** Bumped when growth replaces the buffer, so whatever bound the old one must bind again */
  public bufferVersion = 0;

  private _texture: Texture | null = null;
  private _textureSource: BufferImageSource | null = null;

  private readonly _retiredBuffers: Buffer3D[] = [];

  /**
   * The `Skeleton._worldId` each `add` slot last copied. A match skips the copy only while no earlier
   * slot changed, and `update` trims it to the frame's adds, since later slots may lie under moved bones
   */
  private readonly _slotWorldIds: number[] = [];
  /**
   * The `Skeleton._worldId` each slot's previous range holds, its own range while {@link keepPrevious} is off. An id
   * copied from another slot never matches, so it costs a copy, never a stale skip
   */
  private readonly _slotPreviousWorldIds: number[] = [];
  private _addCount = 0;
  private _changed = false;
  private _keepsPrevious = false;

  constructor(options: BonePitOptions = {}) {
    const initialBones = options.initialBoneCapacity ?? 256;
    this.data = new Float32Array(alignToDataTextureRows(initialBones * BONE_MATRIX_FLOATS));
  }

  public get buffer(): Buffer3D {
    return (this._buffer ??= new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'BonePit',
      shrinkToFit: false,
    }));
  }

  public get bufferResource(): BufferResource {
    return (this._bufferResource ??= new BufferResource({ buffer: this.buffer }));
  }

  public get texture(): Texture {
    return this._texture || this._initTexture();
  }

  private _initTexture(): Texture {
    const { width, height } = dataTextureSize(this.data.length);

    this._textureSource = new BufferImageSource({
      resource: this.data,
      width,
      height,
      format: 'rgba32float',
      scaleMode: 'nearest',
      alphaMode: 'no-premultiply-alpha',
    });

    this._texture = new Texture({ source: this._textureSource });
    return this._texture;
  }

  /**
   * While on, each skeleton takes twice its joints: this render's matrices, then the previous render's at
   * `Skeleton._previousBonePitIndex`, which `add` copies from the skeleton's own range before overwriting it, or
   * takes from this render when the range is new or moved
   * @returns Whether it started or stopped, which moves the skinned meshes' bases
   */
  public keepPrevious(keep: boolean): boolean {
    if (keep === this._keepsPrevious) return false;

    this._keepsPrevious = keep;
    this._slotWorldIds.length = 0;

    return true;
  }

  public clear(): void {
    this._boneCount = 0;
    this._addCount = 0;
    this._tick++;
  }

  public add(skeleton: Skeleton): number {
    if (skeleton._bonePitTick === this._tick) {
      return skeleton._bonePitIndex;
    }

    const baseIndex = this._boneCount;
    const sameBase = skeleton._bonePitTick === this._tick - 1 && skeleton._bonePitIndex === baseIndex;
    skeleton._bonePitTick = this._tick;

    const slot = this._addCount++;
    const previousIndex = this._keepsPrevious ? baseIndex + skeleton.jointCount : baseIndex;
    const worldId = skeleton._worldId;

    this._boneCount = previousIndex + skeleton.jointCount;
    skeleton._bonePitIndex = baseIndex;
    skeleton._previousBonePitIndex = previousIndex;

    if (!this._changed && this._slotWorldIds[slot] === worldId && this._slotPreviousWorldIds[slot] === worldId) {
      return baseIndex;
    }

    this._changed = true;
    this._ensureCapacity(this._boneCount);

    const data = this.data;
    const start = baseIndex * BONE_MATRIX_FLOATS;
    if (previousIndex === baseIndex) {
      this._slotPreviousWorldIds[slot] = worldId;
    } else if (sameBase) {
      data.copyWithin(previousIndex * BONE_MATRIX_FLOATS, start, previousIndex * BONE_MATRIX_FLOATS);
      this._slotPreviousWorldIds[slot] = this._slotWorldIds[slot];
    } else {
      data.set(skeleton.worldMatrix, previousIndex * BONE_MATRIX_FLOATS);
      this._slotPreviousWorldIds[slot] = worldId;
    }

    this._slotWorldIds[slot] = worldId;
    data.set(skeleton.worldMatrix, start);

    return baseIndex;
  }

  public update(): void {
    if (this._slotWorldIds.length !== this._addCount) this._slotWorldIds.length = this._addCount;
    if (this._slotPreviousWorldIds.length !== this._addCount) this._slotPreviousWorldIds.length = this._addCount;
    if (!this._changed) return;

    this._changed = false;
    if (this._boneCount === 0) return;

    const floats = this._boneCount * BONE_MATRIX_FLOATS;

    this._buffer?.update(floats * 4, 0);
    if (this._textureSource) uploadFloatRange(this._textureSource, 0, floats);
  }

  /** Retires the buffer rather than destroying it, since draws recorded earlier still bind it; `_freeRetired` frees it */
  private _ensureCapacity(requiredBoneCount: number): void {
    const requiredFloats = requiredBoneCount * BONE_MATRIX_FLOATS;
    if (requiredFloats <= this.data.length) return;

    let newFloatCapacity = this.data.length;
    while (newFloatCapacity < requiredFloats) newFloatCapacity *= 2;
    newFloatCapacity = alignToDataTextureRows(newFloatCapacity);

    const newData = new Float32Array(newFloatCapacity);
    newData.set(this.data);
    this.data = newData;

    if (this._buffer) {
      this._retiredBuffers.push(this._buffer);
      this._buffer = null;
      this._bufferResource = null;
    }
    this.bufferVersion++;

    if (this._textureSource) {
      const { width, height } = dataTextureSize(this.data.length);

      this._textureSource.resource = this.data;

      if (this._textureSource.width !== width || this._textureSource.height !== height) {
        this._textureSource.resize(width, height);
      }
      this._textureSource.update();
    }
  }

  private _freeRetired(): void {
    for (let i = 0; i < this._retiredBuffers.length; i++) this._retiredBuffers[i].destroy();
    this._retiredBuffers.length = 0;
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
    (this._slotWorldIds as number[] | null) = null;
    (this._slotPreviousWorldIds as number[] | null) = null;
    this._buffer = null;
    this._bufferResource = null;

    this._texture = null;
    this._textureSource = null;
  }
}
