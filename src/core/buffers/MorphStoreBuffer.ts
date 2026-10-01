import { BufferImageSource, BufferResource, BufferUsage, Texture, warn } from 'pixi.js';

import type { Geometry3D } from '../../geometry/Geometry3D';
import type { Mesh3D } from '../../scene/Mesh3D';
import type { Morph } from '../../scene/Morph';
import { Buffer3D } from './Buffer3D';
import { alignToDataTextureRows, dataTextureSize, uploadFloatRange } from './dataTextureLayout';

/** Floats per stored delta: `xyz` and an unused `w`, so each delta fills one texel */
const FLOATS_PER_DELTA = 4;

/**
 * Options for `MorphStoreBuffer`
 * @internal
 */
interface MorphStoreBufferOptions {
  /** Initial delta-arena reservation, in floats; weights start at this offset */
  deltaCapacity?: number;
  /** Initial weight-region capacity, in floats */
  weightCapacity?: number;
}

/**
 * The renderer's morph storage, one array shared by every view, in two regions
 *
 * - The delta arena, from 0 up to the weights base, holds each geometry's morph deltas, packed
 *   once by `uploadDeltas`, which records the block's start as `geometry._morphDeltaBase`. Blocks
 *   are bump-allocated. A destroyed geometry's block goes on a free list for its exact size and
 *   the next pack of that size reuses it, so streaming the same asset in and out can't grow the
 *   arena.
 * - The weight region, from the weights base on, holds one fixed slot per morphed mesh, rounded up
 *   to a power of two and recycled per size when a mesh leaves the scene. A slot is written only
 *   when its mesh's weights change.
 *
 * The weights base is the arena's capacity, not its used size, so a new geometry that fits moves
 * nothing. Only an arena doubling moves the weight region. Slots are stored relative to the base,
 * so `sync` recomputes each mesh's absolute offset and re-emits its store row only when it moved.
 *
 * Deltas and weights share one buffer so morphing takes one storage-buffer binding in the global
 * group. Every view can share it because neither region depends on the view: deltas belong to the
 * geometry and weights to the mesh. Views notice a reallocation through `bufferVersion`, in
 * `detectSharedCacheInvalidation`.
 *
 * WebGPU binds `bufferResource` as `uMorphStorage`. WebGL has no storage buffers, so it binds
 * `texture`, an `rgba32float` data texture whose texel `i` holds floats `i * 4` to `i * 4 + 3`, as
 * the bone pit does. Each view is made on first read.
 *
 * Geometries and morphs belong to the user and outlive the store, which dies with its renderer, so
 * the store keeps no list of them. Each carries the store that packed or slotted it, `_morphStore`
 * or `_store`, and `uploadDeltas` and `sync` check it. Nothing from another store is adopted. A
 * morph's weight slot is freed there and the morph gets a new one here. A geometry's delta block is
 * freed there too, but its raw targets were released at the first pack, so it warns once and draws
 * unmorphed. Calls to a destroyed store do nothing. Only one renderer may draw a morphed mesh at a
 * time: two live renderers would swap its slot every frame.
 * @internal
 */
export class MorphStoreBuffer {
  /** Backing CPU array: delta arena followed by the weight-slot region */
  public data: Float32Array;

  private _buffer: Buffer3D | null = null;
  private _bufferResource: BufferResource | null = null;

  /**
   * Bumped whenever the array is reallocated
   *
   * Each view compares it in `detectSharedCacheInvalidation` and re-records its cached bundles.
   */
  public bufferVersion = 0;

  /** Used floats in the delta arena */
  private _deltaCursor = 0;
  /** Delta-arena reservation, in floats; weight slots start here */
  private _deltaCapacity = 0;
  /** Bump cursor for fresh weight slots, relative to the weights base */
  private _weightCursor = 0;
  /** Recycled weight slots (relative offsets), keyed by bucket size */
  private readonly _freeSlots = new Map<number, number[]>();

  /**
   * Recycled delta blocks' start offsets, keyed by exact size in floats
   *
   * Exact sizes work because a block's size is `vertexCount × targetCount × stride`, which recurs
   * whenever the same asset streams back in, the churn this reclaims.
   */
  private readonly _freeDeltaBlocks = new Map<number, number[]>();

  private _minDirty = Infinity;
  private _maxDirty = -Infinity;

  /** Buffers `_reallocate` replaced; it says why they're kept, and `destroy` frees them */
  private readonly _retiredBuffers: Buffer3D[] = [];

  private _texture: Texture | null = null;
  private _textureSource: BufferImageSource | null = null;

  constructor(options: MorphStoreBufferOptions = {}) {
    this._deltaCapacity = options.deltaCapacity ?? 4096;
    const weightCapacity = alignWeightCapacity(this._deltaCapacity, options.weightCapacity ?? 1024);

    this.data = new Float32Array(this._deltaCapacity + weightCapacity);
  }

  /**
   * The WebGPU view: a storage buffer over the array, created on first read
   *
   * A {@link Buffer3D}, so pixi's GC never frees it under a recorded bundle that binds it.
   */
  public get buffer(): Buffer3D {
    return (this._buffer ??= new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'MorphStoreBuffer',
      shrinkToFit: false,
    }));
  }

  /** Bindable resource over {@link MorphStoreBuffer#buffer} */
  public get bufferResource(): BufferResource {
    return (this._bufferResource ??= new BufferResource({ buffer: this.buffer }));
  }

  /**
   * The WebGL view: an `rgba32float` data texture over the same array, created on first read
   *
   * The GL morph bits read it with `texelFetch`. `update` uploads its changed texels, and a
   * reallocation resizes it.
   */
  public get texture(): Texture {
    return this._texture || this._initTexture();
  }

  /**
   * Packs a geometry's deltas into the arena and records the block's start in
   * `geometry._morphDeltaBase`
   *
   * Does nothing once packed here, or for a geometry without deltas. It releases the raw targets
   * afterwards, so a geometry packed by another store, usually a destroyed renderer's, can't pack
   * again: its block goes back to that store, and it warns once and draws unmorphed here.
   *
   * Target `i`'s deltas for vertex `vid` sit at `base + (vid * targetCount + i) * stride`. The
   * stride is one texel, position `xyz` and a pad, or two texels, position then normal, when
   * {@link Geometry3D#hasMorphNormals} is set. The matching shader variant has the stride built in,
   * so no per-instance data carries it. The vertex count comes from the first target's length,
   * since glTF requires every morph target accessor to have the original primitive's vertex count.
   *
   * While packing, it records each target's longest position delta. Their sum is how far any
   * vertex can move for weights in [0, 1], which becomes `geometry._morphBoundsExpansion`.
   * @param geometry - The geometry whose morph deltas to pack.
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

  /**
   * Returns a geometry's delta block to the free list for its size
   *
   * `Geometry3D.destroy` calls it: every mesh drawing the geometry shares its deltas, so the block
   * lives as long as the geometry. Weight slots are freed separately, when a mesh leaves the scene.
   * Once the store is destroyed, it only resets the geometry.
   * @param geometry - The geometry whose delta block to free.
   */
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

  /**
   * Brings a view's morphed meshes up to date for the frame, then uploads
   *
   * Two loops on purpose. Every new geometry packs first, because arena growth moves the weights
   * base and every offset must come from the final base. Then each mesh gets a weight slot, moving
   * it from another store if needed, and its weights are copied in. A mesh's store row holds the
   * absolute offset, so the row is re-emitted only when the offset moved: a new slot, or arena
   * growth. The upload does nothing when nothing changed, so every view can call this each frame.
   * @param morphedMeshes - The view's meshes that carry a morph.
   */
  public sync(morphedMeshes: Mesh3D[]): void {
    for (let i = 0; i < morphedMeshes.length; i++) {
      this.uploadDeltas(morphedMeshes[i].geometry);
    }

    const weightsBase = this._deltaCapacity;
    for (let i = 0; i < morphedMeshes.length; i++) {
      const mesh = morphedMeshes[i];
      const morph = mesh.morph!;
      if (morph._store !== this) {
        morph._store?.freeSlot(morph);
        this.allocSlot(morph);
      }
      const absolute = weightsBase + morph._slot;
      if (morph._weightIndex !== absolute) {
        morph._weightIndex = absolute;
        mesh._storeDirty = true;
      }
      this.writeWeights(morph);
    }

    this.update();
  }

  /**
   * Gives the morph a weight slot, at an offset relative to the weights base
   *
   * Reuses a freed slot of the same power-of-two size when there is one. The morph keeps it until
   * `freeSlot`, when the mesh leaves the scene.
   * @param morph - The morph to give a slot to.
   */
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

  /**
   * Returns the morph's weight slot to the free list for its size
   *
   * Called when the mesh leaves the scene, when its view is destroyed, or when another store takes
   * the morph. Once the store is destroyed, it only resets the morph.
   * @param morph - The morph whose slot to release.
   */
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
   * Copies the morph's weights into its slot
   *
   * Compares as it copies and marks the slot for upload only when a value changed. That is all the
   * change tracking there is: the CPU array mirrors the GPU's, so any difference, whether from an
   * animation, a hand edit or a reused slot's old values, shows up here with no dirty flag anywhere.
   * The copy stops at the slot's size, so a weights array swapped for a longer one can't write past
   * it.
   * @param morph - The morph whose weights to diff in.
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

  /**
   * Uploads the changed span to whichever GPU views exist
   *
   * Does nothing when nothing changed, so the first view to call it in a frame does the upload.
   */
  public update(): void {
    if (this._minDirty > this._maxDirty) return;

    this._buffer?.update((this._maxDirty - this._minDirty + 1) * 4, this._minDirty * 4);

    if (this._textureSource) uploadFloatRange(this._textureSource, this._minDirty, this._maxDirty + 1);

    this._minDirty = Infinity;
    this._maxDirty = -Infinity;
  }

  /** Frees buffers orphaned by growth; `destroy` calls it. Idempotent */
  private _freeRetired(): void {
    for (let i = 0; i < this._retiredBuffers.length; i++) this._retiredBuffers[i].destroy();
    this._retiredBuffers.length = 0;
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

  /**
   * Doubles the delta arena to fit `requiredFloats`, relocating the weight region
   * @param requiredFloats - Minimum arena size, in floats
   */
  private _growArena(requiredFloats: number): void {
    let capacity = this._deltaCapacity;
    while (capacity < requiredFloats) capacity *= 2;
    this._reallocate(capacity, this.data.length - this._deltaCapacity);
  }

  /**
   * Doubles the weight region until it holds `requiredFloats`; the arena and every slot's absolute
   * offset stay put
   * @param requiredFloats - Minimum weight-region size, in floats
   */
  private _growWeights(requiredFloats: number): void {
    let capacity = this.data.length - this._deltaCapacity;
    while (capacity < requiredFloats) capacity *= 2;
    this._reallocate(this._deltaCapacity, capacity);
  }

  /**
   * Swaps in a larger array, keeping the packed deltas and the whole weight region
   *
   * Slot offsets are relative, so the free lists survive the arena moving. The buffer is retired
   * rather than resized: draws recorded earlier still bind the old one, which has to outlive their
   * submit, and a {@link Buffer3D} is exempt from pixi's GC, so `destroy` frees it. The next
   * `buffer` read builds a new one over the new array, which uploads whole on first use. The data
   * texture, which only WebGL reads, is pointed at the new array, resized and uploaded whole.
   * @param newDeltaCapacity - New delta-arena size, in floats
   * @param newWeightCapacity - New weight-region size, in floats; padded up to whole data-texture rows
   */
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

/**
 * Pushes a freed offset onto the free list keyed by `size`, creating the list on first use
 * @param lists - Free lists, keyed by block size
 * @param size - Size of the freed block, in floats
 * @param offset - Offset of the freed block, in floats
 */
function recycle(lists: Map<number, number[]>, size: number, offset: number): void {
  let free = lists.get(size);
  if (!free) {
    free = [];
    lists.set(size, free);
  }
  free.push(offset);
}

/**
 * Pads the weight region so the store's total float count fills whole data-texture rows
 *
 * The pad goes in the weight region because the arena's capacity is the weights base, so it can't
 * absorb slack.
 * @param deltaCapacity - Delta-arena size, in floats
 * @param weightCapacity - Requested weight-region size, in floats
 */
function alignWeightCapacity(deltaCapacity: number, weightCapacity: number): number {
  const total = deltaCapacity + weightCapacity;

  return weightCapacity + (alignToDataTextureRows(total) - total);
}
