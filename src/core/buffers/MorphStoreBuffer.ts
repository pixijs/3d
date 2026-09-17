import { BufferImageSource, BufferResource, BufferUsage, Texture, warn } from 'pixi.js';

import type { Geometry3D } from '../../geometry/Geometry3D';
import type { Mesh3D } from '../../scene/Mesh3D';
import type { Morph } from '../../scene/Morph';
import { Buffer3D } from './Buffer3D';
import { alignToDataTextureRows, dataTextureSize } from './dataTextureLayout';

/** Floats per stored delta — `xyz` + an unused `w` so the delta arena stays 16-byte friendly */
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
 * Renderer-shared morph storage backing the single `uMorphStorage` binding for every view
 *
 * One buffer, two regions:
 *
 *   `[0, weightsBase)`   — delta arena: static per-geometry deltas, packed once
 *                          by `uploadDeltas`, which mints
 *                          `geometry._morphDeltaBase`. Bump-allocated; a destroyed
 *                          geometry's block returns to a size-keyed free list
 *                          (`freeDeltas`) and is reused by the next same-extent
 *                          pack, so same-asset streaming churn can't grow the
 *                          arena.
 *   `[weightsBase, ...)`  — weight slots: one fixed run per morphed mesh, bucketed
 *                          to power-of-two sizes and recycled through per-bucket
 *                          free lists when a mesh leaves the scene. Written only
 *                          when a mesh's weights change.
 *
 * The weights base (`_deltaCapacity`) is the arena's *capacity*, not its used size, so new
 * geometries that fit the reservation shift nothing. Only an arena doubling moves the
 * weight region — slots are stored relative to the weights base, so the scene
 * update re-derives each mesh's absolute offset (`_morphWeightIndex`) per frame
 * and re-emits its store row on exactly those frames.
 *
 * Deltas and weights share one buffer because the global bind group has a
 * single storage slot left; sharing across views works because both regions are
 * view-independent (deltas are canonical, weights are per-mesh state). Views
 * detect reallocation through `bufferVersion` via
 * `detectSharedCacheInvalidation`.
 *
 * Two transports over the same backing array: WebGPU binds `bufferResource` as
 * `uMorphStorage`; WebGL (no storage buffers) binds the lazily-created
 * `texture` — an rgba32float data-texture view whose texel `i` is floats
 * `[i*4, i*4+4)`, the same pattern the bone pit and material store already use
 * there.
 *
 * Geometries and morphs are user-owned and outlive the store (which dies with
 * its renderer), so the store keeps no membership list: each carries the store
 * that packed or slotted it (`_morphStore` / `_store`), and `uploadDeltas` /
 * `sync` re-check that identity on sight. Nothing from another store is
 * adopted: a weight slot is freed there and re-minted here; a delta block is
 * freed there too, but since the raw targets went at pack the geometry warns
 * once and renders unmorphed. Calls through a back-reference to a destroyed
 * store are no-ops. One live renderer at a time — two live renderers drawing
 * the same morphed mesh would re-slot it every frame.
 * @internal
 */
export class MorphStoreBuffer {
  /** Backing CPU array: delta arena followed by the weight-slot region */
  public data: Float32Array;

  /**
   * GPU buffer (storage)
   *
   * A {@link Buffer3D}, so replayed render bundles bind it without touching
   * pixi's GC usage tracking.
   */
  public buffer: Buffer3D;

  /** Bindable resource for shaders */
  public bufferResource: BufferResource;

  /**
   * Incremented whenever the backing buffer is reallocated
   *
   * Compared per view by `detectSharedCacheInvalidation` to re-record cached
   * bundles.
   */
  public bufferVersion = 0;

  /** Used floats in the delta arena */
  private _deltaCursor = 0;
  /** Delta-arena reservation, in floats; weight slots start here */
  private _deltaCapacity: number;
  /** Bump cursor for fresh weight slots, relative to the weights base */
  private _weightCursor = 0;
  /** Recycled weight slots (relative offsets), keyed by bucket size */
  private readonly _freeSlots = new Map<number, number[]>();

  /**
   * Recycled delta blocks (base float offsets), keyed by exact float extent
   *
   * Exact-size buckets work because a block's size is
   * `vertexCount × targetCount × stride`, which recurs whenever the same asset
   * streams back in — the churn pattern this reclaims.
   */
  private readonly _freeDeltaBlocks = new Map<number, number[]>();

  private _minDirty = Infinity;
  private _maxDirty = -Infinity;

  /**
   * Old buffers orphaned by reallocation growth. Render bundles recorded
   * earlier still reference each one, and a `Buffer3D` is exempt from pixi's
   * GC, so we retain each until `destroy` frees them. Growth
   * is rare (capacity doubling) so this stays tiny.
   */
  private readonly _retiredBuffers: Buffer3D[] = [];

  private _texture: Texture | null = null;
  private _textureSource: BufferImageSource | null = null;

  constructor(options: MorphStoreBufferOptions = {}) {
    this._deltaCapacity = options.deltaCapacity ?? 4096;
    const weightCapacity = alignWeightCapacity(this._deltaCapacity, options.weightCapacity ?? 1024);

    this.data = new Float32Array(this._deltaCapacity + weightCapacity);
    this.buffer = this._createBuffer();
    this.bufferResource = new BufferResource({ buffer: this.buffer });
  }

  /**
   * The WebGL transport: an rgba32float data-texture view over the same backing array
   *
   * Read with `texelFetch` by the GL morph bits. Lazily created; refreshed by
   * `update` and resized on reallocation.
   */
  public get texture(): Texture {
    return this._texture || this._initTexture();
  }

  /**
   * Packs a geometry's deltas into the arena (once) and records its base float
   * offset in `geometry._morphDeltaBase`
   *
   * No-op once packed here or when it has no deltas. Releases the raw source
   * arrays afterwards, so a geometry packed by another store can only hand its
   * block back there: it warns once and stays unpacked here.
   *
   * Layout: target `i`'s deltas for local vertex `vid` sit at
   * `base + (vid * targetCount + i) * stride`, where the stride is one texel
   * (position `xyz` + pad) or — when {@link Geometry3D#hasMorphNormals} — two
   * texels (position texel, then normal texel). The stride is baked into the
   * matching shader variant, so no per-instance data carries it.
   * @param geometry - The geometry whose morph deltas to pack.
   */
  public uploadDeltas(geometry: Geometry3D): void {
    const old = geometry._morphStore;
    if (old === this) return;

    // Packed by another store (a destroyed renderer's, typically): the block
    // goes back there, and the geometry reads as unpacked from now on — the
    // geometry-row copier writes the unmorphed texel for it.
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
    // Derive vertex count from the deltas (3 floats per vertex); glTF guarantees
    // this matches the base geometry's vertex count.
    const vertexCount = targets[0].positions.length / 3;
    const floats = vertexCount * targetCount * stride;

    // Reuse a freed block of the same extent before bumping the arena.
    const recycled = this._freeDeltaBlocks.get(floats);
    let base: number;
    if (recycled && recycled.length > 0) {
      base = recycled.pop()!;
    } else {
      base = this._deltaCursor;
      if (base + floats > this._deltaCapacity) this._growArena(base + floats);
      this._deltaCursor += floats;
    }

    // Per-target max position-delta length, tracked while packing — Σ of these
    // is the conservative bounds expansion (a morphing vertex can't move
    // further for weights in [0, 1]).
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
   * Returns a geometry's packed delta block to its extent's free list
   *
   * Called from `Geometry3D.destroy` — the deltas are canonical per-geometry
   * state shared by every mesh drawing it, so geometry lifetime is the block's
   * lifetime (weight slots recycle separately, on scene membership). The
   * geometry carries the store reference, so no renderer context is needed.
   * @param geometry - The geometry whose delta block to free.
   */
  public freeDeltas(geometry: Geometry3D): void {
    const base = geometry._morphDeltaBase;
    if (base < 0) return;

    const floats = geometry._morphDeltaFloats;
    geometry._morphDeltaBase = -1;
    geometry._morphDeltaFloats = 0;
    geometry._morphStore = null;

    // Store already torn down with its renderer — nothing left to recycle.
    if (!this.buffer) return;

    recycle(this._freeDeltaBlocks, floats, base);
  }

  /**
   * Per-frame sync for a view's morphed meshes — the whole morph prepare pass
   *
   * Two passes on purpose: all new geometries pack first, because arena growth
   * moves the weights base and every slot must absolutize against the settled
   * base; then each mesh gets its slot ensured, its baked offset checked, and
   * its dials diffed in. Ends with the ranged upload (a no-op when clean, so
   * multiple views calling per frame is safe).
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
      // A slot from another store (a destroyed renderer's, typically) names one
      // of ours by number only — it goes back there, or two meshes share the run.
      if (morph._store !== this) {
        morph._store?.freeSlot(morph);
        this.allocSlot(morph);
      }
      // Rows bake the absolute offset. It moves only on a fresh slot or an
      // arena growth (which shifts every slot); re-emit the row exactly then.
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
   * Assigns the morph a fixed weight slot (relative to the weights base)
   *
   * Recycles a freed slot of the same bucket when one exists. The slot is held
   * until `freeSlot` — the mesh leaving the scene.
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
   * Returns the morph's weight slot to its bucket's free list
   *
   * Called when the mesh leaves the scene, its view is destroyed, or another
   * store re-slots it; the morph carries the store reference, so any owner can
   * release without renderer context.
   * @param morph - The morph whose slot to release.
   */
  public freeSlot(morph: Morph): void {
    const slot = morph._slot;
    if (slot < 0) return;

    const size = morph._slotSize;
    morph._slot = -1;
    morph._slotSize = 0;
    morph._store = null;

    // Store already torn down with its renderer — nothing left to recycle.
    if (!this.buffer) return;

    recycle(this._freeSlots, size, slot);
  }

  /**
   * Syncs the morph's slot to its current weights
   *
   * A fused compare-and-copy that marks the range for upload only when a value
   * actually changed. This is the whole change-detection story — the CPU array
   * mirrors what the GPU holds, so any divergence (animation write, hand
   * mutation, recycled-slot residue) is caught here without a dirty flag
   * anywhere. Iteration is clamped to the allocated bucket, so a weights array
   * swapped for a longer one can't write past its slot.
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
   * Uploads the dirty range to the GPU
   *
   * No-op when nothing changed, so calling once per view walk is safe — the
   * first walk of the frame flushes.
   */
  public update(): void {
    if (this._minDirty > this._maxDirty) return;

    this.buffer.update((this._maxDirty - this._minDirty + 1) * 4, this._minDirty * 4);

    // The WebGL data-texture view re-uploads whole (BufferImageSource has no
    // partial update) — ~KBs at typical store sizes.
    this._textureSource?.update();

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
   * Covers the exclusively-owned GPU buffer, the lazily-created WebGL
   * data-texture (if any), and every buffer retired by growth. Idempotent — a
   * second call is a no-op.
   */
  public destroy(): void {
    if (!this.buffer) return;

    // Free the BufferResource first (destroyBuffer:false) so bound bind groups
    // react to its change before the referenced Buffer is destroyed.
    this.bufferResource.destroy(false);
    this.buffer.destroy();

    this._freeRetired();

    // `_texture.destroy(true)` also frees the owned BufferImageSource.
    this._texture?.destroy(true);
    this._texture = null;
    this._textureSource = null;

    (this.data as Float32Array | null) = null;
    (this.buffer as Buffer3D | null) = null;
    (this.bufferResource as BufferResource | null) = null;
  }

  private _createBuffer(): Buffer3D {
    return new Buffer3D({
      data: this.data,
      usage: BufferUsage.STORAGE | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'MorphStoreBuffer',
      shrinkToFit: false,
    });
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
   * Doubles the weight region to fit `requiredFloats` (relative); the arena —
   * and every slot's absolute offset — stays put.
   * @param requiredFloats - Minimum weight-region size, in floats
   */
  private _growWeights(requiredFloats: number): void {
    let capacity = this.data.length - this._deltaCapacity;
    while (capacity < requiredFloats) capacity *= 2;
    this._reallocate(this._deltaCapacity, capacity);
  }

  /**
   * Swaps in a larger backing array/buffer, preserving the packed deltas and
   * the whole weight region (slot offsets are relative, so recycling survives
   * an arena move untouched)
   *
   * The replaced buffer is retired — render bundles recorded earlier still
   * reference it — and the full used extent is marked dirty for the new
   * buffer's first upload. The data-texture view, if created, is re-pointed
   * and resized to the new array.
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

    this._retiredBuffers.push(this.buffer);
    this.buffer = this._createBuffer();
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

    this._markDirty(0, newDeltaCapacity + this._weightCursor - 1);
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
 * Pads the weight capacity so the store's total float count fills whole
 * data-texture rows
 *
 * The pad lands in the weight region because the arena capacity is semantic — it's
 * the weights base — and must never absorb slack.
 * @param deltaCapacity - Delta-arena size, in floats
 * @param weightCapacity - Requested weight-region size, in floats
 */
function alignWeightCapacity(deltaCapacity: number, weightCapacity: number): number {
  const total = deltaCapacity + weightCapacity;

  return weightCapacity + (alignToDataTextureRows(total) - total);
}
