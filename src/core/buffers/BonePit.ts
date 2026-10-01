import { BufferImageSource, BufferResource, BufferUsage, Texture } from 'pixi.js';

import type { Skeleton } from '../../scene/Skeleton';
import { Buffer3D } from './Buffer3D';
import { alignToDataTextureRows, dataTextureSize, uploadFloatRange } from './dataTextureLayout';

/**
 * Floats per bone matrix, three rows of four
 *
 * A bone matrix is a joint world transform times an inverse bind, and both come out of
 * `Matrix4.multiplyAffine`, so the fourth row is always `(0, 0, 0, 1)`. Storing it would cost
 * four floats and four component loads per bone for no information. See
 * {@link Matrix4.multiplyAffineTo3x4} for the layout and why the shader prefers it.
 * @internal
 */
export const BONE_MATRIX_FLOATS = 12;

/**
 * Options for `BonePit`
 * @internal
 */
interface BonePitOptions {
  /** Initial capacity in bone matrices, not floats; defaults to 256 */
  initialBoneCapacity?: number;
}

/**
 * A view's bone matrices for the frame, every skeleton's packed one after another
 *
 * One buffer for the whole view, so no skeleton needs a storage buffer of its own. Each frame:
 *
 * - `clear()` first.
 * - `add(skeleton)` for every skeleton drawn, which appends `skeleton.worldMatrix` and returns the
 *   index of its first bone, counted in bones rather than floats.
 * - `update()` once after the adds, to upload the part in use.
 *
 * Skinning reads bone `baseIndex + jointIndex`, and on both backends the base index reaches the
 * shader through the bone lane of the mesh's store row.
 * @internal
 */
export class BonePit {
  /**
   * The CPU array of packed bone matrices
   *
   * Sized to whole data-texture rows once it's past one row, so the WebGL texture never claims
   * texels past its end.
   */
  public data: Float32Array;

  private _buffer: Buffer3D | null = null;
  private _bufferResource: BufferResource | null = null;

  private _boneCount = 0;
  private _tick = 0;
  /**
   * Bumped whenever `_ensureCapacity` reallocates the array
   *
   * `updateView3DScene` invalidates the view's draw caches when it moves, since every batch in the
   * view binds the bone buffer.
   */
  public bufferVersion = 0;

  private _texture: Texture | null = null;
  private _textureSource: BufferImageSource | null = null;

  /** Buffers `_ensureCapacity` replaced; it says why they're kept, and `_freeRetired` frees them */
  private readonly _retiredBuffers: Buffer3D[] = [];

  constructor(options: BonePitOptions = {}) {
    const initialBones = options.initialBoneCapacity ?? 256;
    this.data = new Float32Array(alignToDataTextureRows(initialBones * BONE_MATRIX_FLOATS));
  }

  /** The bone data as a storage buffer for WebGPU shaders, created on first read */
  public get buffer(): Buffer3D {
    return (this._buffer ??= new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'BonePit',
      shrinkToFit: false,
    }));
  }

  /** Bindable resource over {@link BonePit#buffer} */
  public get bufferResource(): BufferResource {
    return (this._bufferResource ??= new BufferResource({ buffer: this.buffer }));
  }

  /** The bone data as a data texture for WebGL shaders, created on first read */
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

  /** Clears the pit for the next frame; resets the count without clearing memory */
  public clear(): void {
    this._boneCount = 0;
    this._tick++;
  }

  /**
   * Appends a skeleton's bone matrices, once per frame however many meshes share the skeleton
   * @param skeleton - The skeleton whose world matrices to append.
   * @returns The base bone index for this skeleton within the pit (matrix index).
   */
  public add(skeleton: Skeleton): number {
    if (skeleton._bonePitTick === this._tick) {
      return skeleton._bonePitIndex;
    }

    skeleton._bonePitTick = this._tick;

    const baseIndex = this._boneCount;
    const jointCount = skeleton.jointCount;

    this._ensureCapacity(this._boneCount + jointCount);

    const dstOffsetFloats = baseIndex * BONE_MATRIX_FLOATS;
    this.data.set(skeleton.worldMatrix, dstOffsetFloats);

    this._boneCount += jointCount;

    skeleton._bonePitIndex = baseIndex;

    return baseIndex;
  }

  /** Uploads the bones in use to whichever GPU views exist; call once a frame, after the adds */
  public update(): void {
    if (this._boneCount === 0) return;

    const floats = this._boneCount * BONE_MATRIX_FLOATS;

    this._buffer?.update(floats * 4, 0);
    if (this._textureSource) uploadFloatRange(this._textureSource, 0, floats);
  }

  /**
   * Doubles the array, in whole texture rows, until it holds `requiredBoneCount` bones
   *
   * The buffer is retired rather than resized: draws recorded earlier still bind the old one,
   * which has to outlive their submit, and a {@link Buffer3D} is exempt from pixi's GC, so
   * `_freeRetired` frees it on `unload` or `destroy`. The next `buffer` read builds a new one over
   * the new array, which uploads whole on first use. The data texture, which only WebGL reads, is
   * pointed at the new array and resized.
   * @param requiredBoneCount - Bones the array must hold
   */
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

  /** Frees buffers orphaned by growth; `unload` and `destroy` call it. Idempotent */
  private _freeRetired(): void {
    for (let i = 0; i < this._retiredBuffers.length; i++) this._retiredBuffers[i].destroy();
    this._retiredBuffers.length = 0;
  }

  /**
   * Frees the GPU copies of the pit, whichever exist, and keeps the CPU array
   *
   * Covers the buffer, the data texture, and the buffers growth retired. The buffer and
   * the texture re-upload from `data` the next time a shader uses them. Idempotent.
   */
  public unload(): void {
    if (!this.data) return;

    this._buffer?.unload();
    this._textureSource?.unload();
    this._freeRetired();
  }

  /**
   * Releases every owned GPU resource and drops the backing array
   *
   * Covers the buffer and data texture, whichever exist, and every buffer that growth
   * retired. Idempotent, so a second call does nothing.
   */
  public destroy(): void {
    if (!this.data) return;

    this._bufferResource?.destroy(false);
    this._buffer?.destroy();

    this._freeRetired();

    this._texture?.destroy(true);

    (this.data as Float32Array | null) = null;
    this._buffer = null;
    this._bufferResource = null;

    this._texture = null;
    this._textureSource = null;
  }
}
