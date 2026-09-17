import { BufferImageSource, BufferResource, BufferUsage, Texture } from 'pixi.js';

import type { Skeleton } from '../../scene/Skeleton';
import { Buffer3D } from './Buffer3D';
import { alignToDataTextureRows, dataTextureSize } from './dataTextureLayout';

/**
 * Floats per bone matrix — three rows of four
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
  /**
   * Initial capacity in number of bone matrices (not floats)
   * One bone matrix is `BONE_MATRIX_FLOATS` floats (three rows of four).
   */
  initialBoneCapacity?: number;
}

/**
 * Per-frame sequential storage buffer of bone matrices
 *
 * Avoids binding a separate storage buffer per skeleton: everything uploads
 * once per frame into a single big `storage<BoneMatrix>` buffer.
 *
 * Usage:
 * - `clear()` at the start of the frame.
 * - For each skeleton to render this frame: `add(skeleton)` appends
 *   `skeleton.worldMatrix` into the pit and returns the **base bone index**
 *   (in bone-matrix units, not floats).
 * - `update()` once after all adds to upload the used prefix to the GPU.
 *
 * Vertex skinning indexes bones as `baseIndex + jointIndex`; on both backends the base
 * index reaches the shader through the mesh store row's bone lane.
 * @internal
 */
export class BonePit {
  /** Backing CPU array containing packed bone matrices (three rows of four each) */
  public data: Float32Array;

  /** GPU buffer (storage) */
  public buffer: Buffer3D;

  /** Bindable resource for shaders */
  public bufferResource: BufferResource;

  private _boneCount = 0;
  private _tick = 0;
  /**
   * Incremented whenever the backing buffer is reallocated in `_ensureCapacity`
   *
   * `updateView3DScene` watermarks it per view and invalidates the view's draw
   * caches on change — the bone buffer is shared by every batch in the view.
   */
  public bufferVersion = 0;

  /** Texture for WebGL access to bone data */
  private _texture: Texture | null = null;
  private _textureSource: BufferImageSource | null = null;

  /**
   * Old buffers orphaned by `_ensureCapacity` growth. A `Buffer3D` is exempt
   * from pixi's GC, so we retain each one until `destroy` frees them. Growth
   * is rare (capacity doubling) so this stays tiny.
   */
  private readonly _retiredBuffers: Buffer3D[] = [];

  constructor(options: BonePitOptions = {}) {
    const initialBones = options.initialBoneCapacity ?? 256;
    // Whole texture rows: the WebGL view spans them, and a partial last row would claim
    // texels the array doesn't have. Doubling in `_ensureCapacity` preserves it.
    this.data = new Float32Array(alignToDataTextureRows(initialBones * BONE_MATRIX_FLOATS));

    this.buffer = new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'BonePit',
      shrinkToFit: false,
    });

    this.bufferResource = new BufferResource({ buffer: this.buffer });
  }

  /** A texture view of the bone data for WebGL shaders */
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
   * Adds a skeleton's bone matrices into the pit (deduplicates per frame)
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

  /** Uploads the used prefix of the pit to the GPU; call once per frame after all `add()` calls */
  public update(): void {
    if (this._boneCount === 0) return;
    const sizeInBytes = this._boneCount * BONE_MATRIX_FLOATS * 4;
    this.buffer.update(sizeInBytes, 0);

    if (this._textureSource) {
      this._textureSource.update();
    }
  }

  private _ensureCapacity(requiredBoneCount: number): void {
    const requiredFloats = requiredBoneCount * BONE_MATRIX_FLOATS;
    if (requiredFloats <= this.data.length) return;

    let newFloatCapacity = this.data.length;
    while (newFloatCapacity < requiredFloats) newFloatCapacity *= 2;

    const newData = new Float32Array(newFloatCapacity);
    newData.set(this.data);
    this.data = newData;

    this._retiredBuffers.push(this.buffer);

    // Create a NEW Buffer so the old GPU buffer stays alive for in-flight
    // render bundles recorded earlier in this frame by other View3D instances.
    this.buffer = new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'BonePit',
      shrinkToFit: false,
    });
    this.bufferResource = new BufferResource({ buffer: this.buffer });
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
   * Frees the GPU copies of the pit — the buffer, the lazily-created WebGL bone
   * data-texture, and everything growth retired — while keeping the CPU array
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
   * Releases every owned GPU resource and drops the backing array
   *
   * Covers the exclusively-owned GPU buffer, the lazily-created WebGL bone
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
    (this.buffer as Buffer3D | null) = null;
    (this.bufferResource as BufferResource | null) = null;

    this._texture = null;
    this._textureSource = null;
  }
}
