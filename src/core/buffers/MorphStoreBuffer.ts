import { BufferImageSource, BufferResource, BufferUsage, Texture, warn } from 'pixi.js';

import type { Geometry3D } from '../../geometry/Geometry3D';
import type { Mesh3D } from '../../scene/Mesh3D';
import type { Morph } from '../../scene/Morph';
import { Buffer3D } from './Buffer3D';
import { alignToDataTextureRows, dataTextureSize, uploadFloatRange } from './dataTextureLayout';

const FLOATS_PER_DELTA = 4;

interface MorphStoreBufferOptions {
  deltaCapacity?: number;
  weightCapacity?: number;
}

/**
 * Geometries' morph deltas, then meshes' weights, in one array so morphing takes one binding
 * @internal
 */
export class MorphStoreBuffer {
  public data: Float32Array;

  private _buffer: Buffer3D | null = null;
  private _bufferResource: BufferResource | null = null;

  /** Bumped when growth replaces the buffer, so whatever bound the old one must bind again */
  public bufferVersion = 0;

  private _deltaCursor = 0;

  /** The arena's capacity, which is also the weights base; weight slots are relative to it */
  private _deltaCapacity = 0;

  private _weightCursor = 0;
  private readonly _freeSlots = new Map<number, number[]>();
  private readonly _freeDeltaBlocks = new Map<number, number[]>();
  private _minDirty = Infinity;
  private _maxDirty = -Infinity;
  private readonly _retiredBuffers: Buffer3D[] = [];

  private _texture: Texture | null = null;
  private _textureSource: BufferImageSource | null = null;

  constructor(options: MorphStoreBufferOptions = {}) {
    this._deltaCapacity = options.deltaCapacity ?? 4096;
    const weightCapacity = alignWeightCapacity(this._deltaCapacity, options.weightCapacity ?? 1024);

    this.data = new Float32Array(this._deltaCapacity + weightCapacity);
  }

  public get buffer(): Buffer3D {
    return (this._buffer ??= new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'MorphStoreBuffer',
      shrinkToFit: false,
    }));
  }

  public get bufferResource(): BufferResource {
    return (this._bufferResource ??= new BufferResource({ buffer: this.buffer }));
  }

  public get texture(): Texture {
    return this._texture || this._initTexture();
  }

  /**
   * Target `i`'s delta for vertex `vid` sits at `base + (vid * targetCount + i) * stride`, as the morph
   * bits read it. Releases the raw targets, so a geometry another store packed draws unmorphed here
   */
  public uploadDeltas(geometry: Geometry3D): void {
    const old = geometry._morphStore;
    if (old === this) return;

    if (old) {
      old.freeDeltas(geometry);
      warn(`MorphStoreBuffer: geometry #${geometry.uid} was packed by another renderer and draws unmorphed here`);
      return;
    }

    const targets = geometry._morphTargets;
    if (!targets || targets.length === 0) return;

    const withNormals = geometry.hasMorphNormals;
    const stride = withNormals ? FLOATS_PER_DELTA * 2 : FLOATS_PER_DELTA;
    const targetCount = targets.length;
    const vertexCount = targets[0].positions.length / 3;
    const floats = vertexCount * targetCount * stride;

    const recycled = this._freeDeltaBlocks.get(floats);
    let base: number;
    if (recycled && recycled.length > 0) {
      base = recycled.pop()!;
    } else {
      base = this._deltaCursor;
      if (base + floats > this._deltaCapacity) this._growArena(base + floats);
      this._deltaCursor += floats;
    }

    const maxDeltaSq = new Float64Array(targetCount);

    const data = this.data;
    for (let vid = 0; vid < vertexCount; vid++) {
      const src = vid * 3;
      for (let i = 0; i < targetCount; i++) {
        const dst = base + (vid * targetCount + i) * stride;
        const p = targets[i].positions;
        const dx = p[src];
        const dy = p[src + 1];
        const dz = p[src + 2];
        data[dst] = dx;
        data[dst + 1] = dy;
        data[dst + 2] = dz;
        data[dst + 3] = 0;

        const lengthSq = dx * dx + dy * dy + dz * dz;
        if (lengthSq > maxDeltaSq[i]) maxDeltaSq[i] = lengthSq;

        if (withNormals) {
          const n = targets[i].normals!;
          data[dst + 4] = n[src];
          data[dst + 5] = n[src + 1];
          data[dst + 6] = n[src + 2];
          data[dst + 7] = 0;
        }
      }
    }

    let expansion = 0;
    for (let i = 0; i < targetCount; i++) expansion += Math.sqrt(maxDeltaSq[i]);
    geometry._morphBoundsExpansion = expansion;

    geometry._morphDeltaBase = base;
    geometry._morphDeltaFloats = floats;
    geometry._morphStore = this;
    geometry._morphTargets = null;
    this._markDirty(base, base + floats - 1);
  }

  /** The release for `uploadDeltas`, from `Geometry3D.destroy`; once the store is destroyed it only resets the geometry */
  public freeDeltas(geometry: Geometry3D): void {
    const base = geometry._morphDeltaBase;
    if (base < 0) return;

    const floats = geometry._morphDeltaFloats;
    geometry._morphDeltaBase = -1;
    geometry._morphDeltaFloats = 0;
    geometry._morphStore = null;

    if (!this.data) return;

    recycle(this._freeDeltaBlocks, floats, base);
  }

  /** Packs every geometry before placing any weights, since arena growth moves the weights base */
  public sync(morphedMeshes: Mesh3D[]): void {
    for (let i = 0; i < morphedMeshes.length; i++) {
      this.uploadDeltas(morphedMeshes[i].geometry);
    }

    const weightsBase = this._deltaCapacity;
    for (let i = 0; i < morphedMeshes.length; i++) {
      const mesh = morphedMeshes[i];
      const morph = mesh._morph!;
      if (morph._store !== this) {
        morph._store?.freeSlot(morph);
        this.allocSlot(morph);
      }
      const absolute = weightsBase + morph._slot;
      if (morph._weightIndex !== absolute) {
        morph._weightIndex = absolute;
        mesh._markStoreDirty();
      }
      this.writeWeights(morph);
    }

    this.update();
  }

  public allocSlot(morph: Morph): void {
    let size = 1;
    while (size < morph.weights.length) size <<= 1;

    const free = this._freeSlots.get(size);
    let slot: number;

    if (free && free.length > 0) {
      slot = free.pop()!;
    } else {
      slot = this._weightCursor;
      if (this._deltaCapacity + slot + size > this.data.length) {
        this._growWeights(slot + size);
      }
      this._weightCursor += size;
    }

    morph._slot = slot;
    morph._slotSize = size;
    morph._store = this;
  }

  /** Once the store is destroyed it only resets the morph */
  public freeSlot(morph: Morph): void {
    const slot = morph._slot;
    if (slot < 0) return;

    const size = morph._slotSize;
    morph._slot = -1;
    morph._slotSize = 0;
    morph._store = null;

    if (!this.data) return;

    recycle(this._freeSlots, size, slot);
  }

  /**
   * Marks the slot for upload only when a copied value differs, the only change tracking weights have;
   * the copy stops at the slot's size, in case `weights` grew
   */
  public writeWeights(morph: Morph): void {
    const weights = morph.weights;
    const data = this.data;
    const base = this._deltaCapacity + morph._slot;
    const count = Math.min(weights.length, morph._slotSize);

    let changed = false;
    for (let i = 0; i < count; i++) {
      const value = weights[i];
      if (data[base + i] !== value) {
        data[base + i] = value;
        changed = true;
      }
    }
    if (changed) this._markDirty(base, base + count - 1);
  }

  public update(): void {
    if (this._minDirty > this._maxDirty) return;

    this._buffer?.update((this._maxDirty - this._minDirty + 1) * 4, this._minDirty * 4);

    if (this._textureSource) uploadFloatRange(this._textureSource, this._minDirty, this._maxDirty + 1);

    this._minDirty = Infinity;
    this._maxDirty = -Infinity;
  }

  private _freeRetired(): void {
    for (let i = 0; i < this._retiredBuffers.length; i++) this._retiredBuffers[i].destroy();
    this._retiredBuffers.length = 0;
  }

  public destroy(): void {
    if (!this.data) return;

    this._bufferResource?.destroy(false);
    this._buffer?.destroy();

    this._freeRetired();

    this._texture?.destroy(true);
    this._texture = null;
    this._textureSource = null;

    (this.data as Float32Array | null) = null;
    this._buffer = null;
    this._bufferResource = null;
  }

  private _markDirty(from: number, to: number): void {
    if (from < this._minDirty) this._minDirty = from;
    if (to > this._maxDirty) this._maxDirty = to;
  }

  private _growArena(requiredFloats: number): void {
    let capacity = this._deltaCapacity;
    while (capacity < requiredFloats) capacity *= 2;
    this._reallocate(capacity, this.data.length - this._deltaCapacity);
  }

  private _growWeights(requiredFloats: number): void {
    let capacity = this.data.length - this._deltaCapacity;
    while (capacity < requiredFloats) capacity *= 2;
    this._reallocate(this._deltaCapacity, capacity);
  }

  /** Retires the buffer rather than destroying it, since draws recorded earlier still bind it; `destroy` frees it */
  private _reallocate(newDeltaCapacity: number, newWeightCapacity: number): void {
    newWeightCapacity = alignWeightCapacity(newDeltaCapacity, newWeightCapacity);
    const newData = new Float32Array(newDeltaCapacity + newWeightCapacity);

    newData.set(this.data.subarray(0, this._deltaCursor), 0);
    newData.set(this.data.subarray(this._deltaCapacity, this._deltaCapacity + this._weightCursor), newDeltaCapacity);

    this.data = newData;
    this._deltaCapacity = newDeltaCapacity;

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
}

function recycle(lists: Map<number, number[]>, size: number, offset: number): void {
  let free = lists.get(size);
  if (!free) {
    free = [];
    lists.set(size, free);
  }
  free.push(offset);
}

function alignWeightCapacity(deltaCapacity: number, weightCapacity: number): number {
  const total = deltaCapacity + weightCapacity;

  return weightCapacity + (alignToDataTextureRows(total) - total);
}
