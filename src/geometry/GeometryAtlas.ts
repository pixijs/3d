import { BufferUsage, getAttributeInfoFromFormat, Geometry, uid } from 'pixi.js';
import type { Attribute } from 'pixi.js';

import { Buffer3D } from '../core/buffers/Buffer3D';
import type { Geometry3D } from './Geometry3D';

/**
 * Tracks where a geometry's vertex/index data lives within the atlas
 * @internal
 */
export interface GeometryAllocation {
  /** The parent atlas this allocation belongs to */
  atlas: GeometryAtlas;
  /** Vertex offset (in vertices, not bytes) within the merged vertex buffer */
  baseVertex: number;
  /** Index offset (in elements) within the merged index buffer */
  firstIndex: number;
  /** Number of indices for this geometry */
  indexCount: number;
  /** Number of vertices for this geometry */
  vertexCount: number;
}

const DEFAULT_VERTEX_CAPACITY = 1024;
const DEFAULT_INDEX_CAPACITY = 2048;

/**
 * Options for {@link GeometryAtlas}
 * @internal
 */
interface GeometryAtlasOptions {
  /** A geometry that defines the attribute layout; its data is NOT copied in, so call `add()` separately */
  referenceGeometry: Geometry3D;
  /**
   * Initial vertex capacity (vertices, not bytes)
   * @default 1024
   */
  initialVertexCapacity?: number;
  /**
   * Initial index capacity (elements)
   * @default 2048
   */
  initialIndexCapacity?: number;
  /**
   * Bake baseVertex into index values for WebGL 2
   * @default false
   */
  rebaseIndices?: boolean;
}

/**
 * Packs multiple {@link Geometry3D} instances with the same attribute layout into a
 * single shared vertex + index buffer so that draw calls for different
 * geometries can share buffers and benefit from instanced batching
 *
 * Geometries must share the same {@link Geometry3D#attributeKey} to be packable
 * together. Removed allocations leave dead space until {@link GeometryAtlas#defragment} (or
 * the next {@link GeometryAtlas#add} that triggers compaction) reclaims it.
 *
 * Constructed and managed exclusively by the WebGL/WebGPU render pipes; user
 * code interacts with the atlas indirectly through the
 * {@link Geometry3DOptions#dynamic} opt-out flag, never by instantiating this
 * class.
 * @see {@link Geometry3D} For the per-mesh geometry that feeds the atlas
 * @internal
 */
export class GeometryAtlas {
  /** Unique ID for this atlas, used in sort keys and batcher grouping */
  public readonly uid: number = uid('geometryAtlas');

  /** Attribute structure key shared by every geometry in this atlas */
  public readonly attributeKey: string;

  /** The vertex stride in bytes (same for all geometries in this atlas) */
  public readonly vertexStride: number;

  private _vertexBuffer: Buffer3D;
  private _indexBuffer: Buffer3D;
  /**
   * Vertex/index buffers orphaned by capacity growth
   *
   * A {@link Buffer3D} is exempt from pixi's GC, so nothing reclaims them —
   * retain each and free it in {@link GeometryAtlas#destroy}.
   */
  private readonly _retiredBuffers: Buffer3D[] = [];
  /**
   * Merged {@link Geometry} wrappers orphaned by capacity growth
   * (nothing else reclaims their GPU layout / VAO — the buffers behind them are
   * {@link Buffer3D}s, which the renderer GC never touches)
   *
   * Their index buffer is detached at retire time (it is freed via
   * `_retiredBuffers`); freed in {@link GeometryAtlas#destroy}.
   */
  private readonly _retiredGeometries: Geometry[] = [];
  private _vertexCount = 0;
  private _indexCount = 0;

  // Dead space, reclaimed on defragment
  private _deadVertexCount = 0;
  private _deadIndexCount = 0;

  // Live allocations, needed for compaction
  private readonly _liveAllocations: GeometryAllocation[] = [];

  private _vertexDirtyMin = Infinity;
  private _vertexDirtyMax = -Infinity;
  private _indexDirtyMin = Infinity;
  private _indexDirtyMax = -Infinity;

  /**
   * Monotonically increasing counter, bumped whenever cached draw state built against this
   * atlas goes stale
   *
   * Raised when growth reallocates the vertex or index buffers, and by every
   * {@link GeometryAtlas#defragment}, which moves live allocations or frees a tail range the next
   * {@link GeometryAtlas#add} reuses. The owning pipe compares it against a per-View3D snapshot to
   * detect stale GPU render bundles.
   * @internal
   */
  public _bufferVersion = 0;

  /** The PixiJS Geometry that wraps the merged vertex + index buffers used for draw calls */
  public geometry: Geometry;

  /** Attribute layout info for building the merged geometry */
  private readonly _attributeInfo: { name: string; attr: Attribute }[];

  /**
   * When true, indices are rebased during {@link GeometryAtlas#add} by baking `baseVertex`
   * into each index value
   *
   * Removes the need for a `baseVertex` draw param, which WebGL 2 doesn't
   * support. When false (default), indices are copied as-is and `baseVertex`
   * is passed to `drawIndexed` at draw time (WebGPU).
   */
  public readonly rebaseIndices: boolean;

  constructor(options: GeometryAtlasOptions) {
    const {
      referenceGeometry,
      initialVertexCapacity = DEFAULT_VERTEX_CAPACITY,
      initialIndexCapacity = DEFAULT_INDEX_CAPACITY,
      rebaseIndices = false,
    } = options;

    this.rebaseIndices = rebaseIndices;

    this.attributeKey = referenceGeometry.attributeKey;

    const attrs = referenceGeometry.attributes;
    const sortedKeys = Object.keys(attrs).sort();

    if (!sortedKeys.some((k) => !attrs[k].instance)) {
      throw new Error('GeometryAtlas: reference geometry has no vertex attributes');
    }

    // Compute the interleaved layout from attribute formats.
    // We can't trust the reference geometry's strides/offsets because it
    // may be non-interleaved (each attribute in its own buffer at offset 0).
    let computedStride = 0;

    this._attributeInfo = [];

    for (const name of sortedKeys) {
      const srcAttr = attrs[name];

      if (srcAttr.instance) continue;

      const byteSize = getAttributeInfoFromFormat(srcAttr.format!).stride;

      // Align offset to 4 bytes (WebGPU requirement)
      computedStride = (computedStride + 3) & ~3;
      const offset = computedStride;

      computedStride += byteSize;

      this._attributeInfo.push({
        name,
        attr: { format: srcAttr.format, offset } as Attribute,
      });
    }

    // Align total stride to 4 bytes
    this.vertexStride = (computedStride + 3) & ~3;

    this._vertexBuffer = new Buffer3D({
      data: new Uint8Array(initialVertexCapacity * this.vertexStride),
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      label: 'GeometryAtlas-vertex',
      shrinkToFit: false,
    });

    this._indexBuffer = new Buffer3D({
      data: new Uint32Array(initialIndexCapacity),
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      label: 'GeometryAtlas-index',
      shrinkToFit: false,
    });

    this.geometry = this._buildMergedGeometry();
  }

  /** High watermark: total vertex slots consumed (includes dead space) */
  get vertexCount(): number {
    return this._vertexCount;
  }

  /**
   * Copies a geometry's vertex/index data into the atlas
   *
   * The geometry's {@link Geometry3D#attributeKey | attributeKey} must match this atlas; instance
   * attributes are rejected. When the atlas is full, dead space is reclaimed
   * by an automatic {@link GeometryAtlas#defragment} or the buffers are grown to fit.
   * @param geometry - The source mesh to merge in
   * @returns The allocation describing where the data lives in the merged buffers
   */
  public add(geometry: Geometry3D): GeometryAllocation {
    // Only an allocation in THIS atlas is reusable — one pointing elsewhere is a
    // torn-down atlas's and would draw from freed buffers.
    const existing = geometry._geometryAtlasAllocation;
    if (existing && existing.atlas === this) return existing;

    for (const name in geometry.attributes) {
      if (geometry.attributes[name].instance) {
        throw new Error(
          `GeometryAtlas: Cannot add geometry with instance attribute "${name}". ` +
            `The Atlas is for merging vertex data only; instance data would be lost.`,
        );
      }
    }

    if (geometry.attributeKey !== this.attributeKey) {
      throw new Error(
        `GeometryAtlas: attribute structure mismatch. Expected "${this.attributeKey}", got "${geometry.attributeKey}"`,
      );
    }

    const vertexCount = geometry.vertexCount;
    const srcIndices = geometry.indexBuffer.data;
    const indexCount = srcIndices.length;

    // Ensure space: compact or grow as needed
    const vertexCapacity = this._vertexBuffer.data.byteLength / this.vertexStride;
    const indexCapacity = this._indexBuffer.data.length;

    const needsVertexRoom = this._vertexCount + vertexCount > vertexCapacity;
    const needsIndexRoom = this._indexCount + indexCount > indexCapacity;

    if (needsVertexRoom || needsIndexRoom) {
      const liveVertices = this._vertexCount - this._deadVertexCount;
      const liveIndices = this._indexCount - this._deadIndexCount;
      const vertexFits = liveVertices + vertexCount <= vertexCapacity;
      const indexFits = liveIndices + indexCount <= indexCapacity;

      if (vertexFits && indexFits) {
        this.defragment();
      } else {
        if (this._deadVertexCount > 0 || this._deadIndexCount > 0) {
          this.defragment();
        }
        this._ensureVertexCapacity(this._vertexCount + vertexCount);
        this._ensureIndexCapacity(this._indexCount + indexCount);
      }
    }

    const baseVertex = this._vertexCount;
    const firstIndex = this._indexCount;
    this._vertexCount += vertexCount;
    this._indexCount += indexCount;

    const vertexData = this._vertexBuffer.data;
    const indexData = this._indexBuffer.data;
    const vertexStride = this.vertexStride;

    // Check if the vertex copy can use the fast path (interleaved and correct stride)
    const firstAttrName = this._attributeInfo[0].name;
    const firstAttr = geometry.attributes[firstAttrName];
    const isInterleaved = this._isGeometryInterleaved(geometry);

    if (isInterleaved && firstAttr.stride === vertexStride) {
      // FAST PATH: bulk copy the entire interleaved buffer
      const srcBytes = firstAttr.buffer.data;
      const dstByteOffset = baseVertex * vertexStride;
      vertexData.set(srcBytes, dstByteOffset);

      this._markVertexDirty(dstByteOffset, dstByteOffset + srcBytes.byteLength);
    } else {
      // GATHER PATH: copy attributes one by one
      for (let i = 0; i < vertexCount; i++) {
        const dstVertexOffset = (baseVertex + i) * vertexStride;

        for (const info of this._attributeInfo) {
          const attr = geometry.attributes[info.name];
          const byteSize = getAttributeInfoFromFormat(info.attr.format!).stride;
          const attrStride = attr.stride ?? byteSize;
          const attrOffset = attr.offset ?? 0;
          const data = attr.buffer.data;

          const srcOffset = i * attrStride + attrOffset;
          const dstOffset = dstVertexOffset + (info.attr.offset ?? 0);

          const srcView = new Uint8Array(data.buffer, data.byteOffset + srcOffset, byteSize);

          vertexData.set(srcView, dstOffset);
        }
      }

      const startByte = baseVertex * vertexStride;
      const endByte = (baseVertex + vertexCount) * vertexStride;

      this._markVertexDirty(startByte, endByte);
    }

    if (this.rebaseIndices) {
      for (let i = 0; i < indexCount; i++) {
        indexData[firstIndex + i] = srcIndices[i] + baseVertex;
      }
    } else {
      indexData.set(srcIndices, firstIndex);
    }

    this._markIndexDirty(firstIndex, firstIndex + indexCount);

    const allocation: GeometryAllocation = {
      atlas: this,
      baseVertex,
      firstIndex,
      indexCount,
      vertexCount,
    };

    geometry._geometryAtlasAllocation = allocation;
    this._liveAllocations.push(allocation);
    return allocation;
  }

  /**
   * Removes a geometry from the atlas
   *
   * The freed range is dead space until the next {@link GeometryAtlas#defragment} (run by
   * {@link GeometryAtlas#add} when the atlas is full but the live set fits). Nothing rebuilds on
   * a removal: the vacated bytes stay where draw commands recorded for this geometry expect them
   * until that compaction, which versions the atlas itself.
   * @param geometry - The previously-added mesh to remove
   */
  public remove(geometry: Geometry3D): void {
    const alloc = geometry._geometryAtlasAllocation;
    if (!alloc) return;

    this._deadVertexCount += alloc.vertexCount;
    this._deadIndexCount += alloc.indexCount;

    const idx = this._liveAllocations.indexOf(alloc);
    if (idx !== -1) this._liveAllocations.splice(idx, 1);

    geometry._geometryAtlasAllocation = null;
  }

  /**
   * Uploads any dirty vertex/index ranges accumulated since the last call to
   * the GPU and clears the dirty trackers
   *
   * Call once per frame after all {@link GeometryAtlas#add}/{@link GeometryAtlas#remove}/
   * {@link GeometryAtlas#defragment} operations have run.
   */
  public update(): void {
    if (this._vertexDirtyMin < this._vertexDirtyMax) {
      const size = this._vertexDirtyMax - this._vertexDirtyMin;
      this._vertexBuffer.update(size, this._vertexDirtyMin);
      this._vertexDirtyMin = Infinity;
      this._vertexDirtyMax = -Infinity;
    }

    if (this._indexDirtyMin < this._indexDirtyMax) {
      const offsetBytes = this._indexDirtyMin * 4;
      const sizeBytes = (this._indexDirtyMax - this._indexDirtyMin) * 4;
      this._indexBuffer.update(sizeBytes, offsetBytes);
      this._indexDirtyMin = Infinity;
      this._indexDirtyMax = -Infinity;
    }
  }

  private _isGeometryInterleaved(geometry: Geometry3D): boolean {
    const firstBuffer = geometry.attributes[this._attributeInfo[0].name].buffer;
    for (let i = 1; i < this._attributeInfo.length; i++) {
      if (geometry.attributes[this._attributeInfo[i].name].buffer !== firstBuffer) {
        return false;
      }
    }
    return true;
  }

  private _buildMergedGeometry(): Geometry {
    const geo = new Geometry();

    for (const { name, attr } of this._attributeInfo) {
      geo.addAttribute(name, {
        buffer: this._vertexBuffer,
        format: attr.format,
        stride: this.vertexStride,
        offset: attr.offset,
      });
    }

    geo.addIndex(this._indexBuffer);

    return geo;
  }

  private _markVertexDirty(startByte: number, endByte: number): void {
    if (startByte < this._vertexDirtyMin) this._vertexDirtyMin = startByte;
    if (endByte > this._vertexDirtyMax) this._vertexDirtyMax = endByte;
  }

  private _markIndexDirty(startIndex: number, endIndex: number): void {
    if (startIndex < this._indexDirtyMin) this._indexDirtyMin = startIndex;
    if (endIndex > this._indexDirtyMax) this._indexDirtyMax = endIndex;
  }

  /**
   * Retires the current merged {@link Geometry} wrapper ahead of a capacity-growth rebuild
   *
   * Its vertex/index buffers are retired separately (so detach the shared index buffer here
   * to avoid a double-free) and the wrapper is freed in {@link GeometryAtlas#destroy}. Kept
   * alive (not destroyed inline) so in-flight render bundles from this frame stay valid.
   */
  private _retireCurrentGeometry(): void {
    if (this.geometry) {
      this.geometry.indexBuffer = null!;
      this._retiredGeometries.push(this.geometry);
    }
  }

  private _ensureVertexCapacity(requiredVertices: number): void {
    const oldData = this._vertexBuffer.data;
    let capacity = oldData.byteLength / this.vertexStride;
    if (requiredVertices <= capacity) return;

    while (capacity < requiredVertices) capacity *= 2;

    const newData = new Uint8Array(capacity * this.vertexStride);
    newData.set(oldData);

    // Retire the outgoing buffer (freed in destroy; see _retiredBuffers).
    this._retiredBuffers.push(this._vertexBuffer);

    // Create a NEW Buffer so the old GPU buffer stays alive for in-flight
    // render bundles recorded earlier in this frame by other View3D instances.
    this._vertexBuffer = new Buffer3D({
      data: newData,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      label: 'GeometryAtlas-vertex',
      shrinkToFit: false,
    });

    // All existing vertex data must be uploaded to the new GPU buffer.
    this._markVertexDirty(0, this._vertexCount * this.vertexStride);

    // Retire the outgoing merged/instance geometry wrappers (their GPU layout
    // would otherwise leak) before rebuilding onto the grown buffers.
    this._retireCurrentGeometry();
    this.geometry = this._buildMergedGeometry();
    this._bufferVersion++;
  }

  private _ensureIndexCapacity(requiredIndices: number): void {
    const oldData = this._indexBuffer.data;
    let capacity = oldData.length;
    if (requiredIndices <= capacity) return;

    while (capacity < requiredIndices) capacity *= 2;

    const newData = new Uint32Array(capacity);
    newData.set(oldData);

    // Retire the outgoing buffer (freed in destroy; see _retiredBuffers).
    this._retiredBuffers.push(this._indexBuffer);

    // Create a NEW Buffer so the old GPU buffer stays alive for in-flight
    // render bundles recorded earlier in this frame by other View3D instances.
    this._indexBuffer = new Buffer3D({
      data: newData,
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      label: 'GeometryAtlas-index',
      shrinkToFit: false,
    });

    // All existing index data must be uploaded to the new GPU buffer.
    this._markIndexDirty(0, this._indexCount);

    // Retire the outgoing merged/instance geometry wrappers (their GPU layout
    // would otherwise leak) before rebuilding onto the grown buffers.
    this._retireCurrentGeometry();
    this.geometry = this._buildMergedGeometry();
    this._bufferVersion++;
  }

  /**
   * Releases the GPU resources exclusively owned by this atlas: the merged
   * vertex + index buffers and the merged {@link GeometryAtlas#geometry}
   *
   * Driven by the owning pipe's `destroy()`; one atlas pool exists per pipe.
   *
   * Geometries are destroyed without their buffers first so the shared
   * vertex/index buffers can then be freed explicitly exactly once.
   * References are nulled so a second call is a no-op.
   *
   * Externally-shared geometries the atlas merely copies data from (the
   * reference geometry, each added {@link Geometry3D}) are never destroyed.
   */
  public destroy(): void {
    if (this._vertexBuffer === null) return;

    // The merged geometry shares this atlas's vertex + index buffers, and pixi's
    // Geometry.destroy frees `indexBuffer` unconditionally (even with
    // destroyBuffers = false). Detach the shared index buffer before destroying it so it
    // isn't double-freed; the shared vertex / index buffers are then freed explicitly
    // exactly once below.
    if (this.geometry) this.geometry.indexBuffer = null!;
    this.geometry?.destroy(false);
    this.geometry = null!;

    this._vertexBuffer.destroy();
    this._indexBuffer.destroy();

    // Free the GPU layout of every geometry wrapper orphaned by growth (index
    // already detached at retire time; shared buffers freed below). Then free
    // every buffer orphaned by growth — pixi's GC never reclaims either.
    for (let i = 0; i < this._retiredGeometries.length; i++) {
      this._retiredGeometries[i].destroy(false);
    }
    this._retiredGeometries.length = 0;

    for (let i = 0; i < this._retiredBuffers.length; i++) {
      this._retiredBuffers[i].destroy();
    }
    this._retiredBuffers.length = 0;

    this._vertexBuffer = null!;
    this._indexBuffer = null!;

    this._liveAllocations.length = 0;
  }

  /**
   * Compacts vertex and index buffers by sliding live allocations down
   * to close gaps left by removed geometries
   *
   * Updates every live allocation's offsets in place so external references stay valid.
   * No-ops when there is no dead space.
   *
   * Every compaction bumps `_bufferVersion` — the same signal growth raises — because it always
   * leaves recorded draw commands stale: a slide moves live allocations away from the
   * `baseVertex` / `firstIndex` they bake, and dead space entirely at the tail still shrinks the
   * live extent, so the next {@link GeometryAtlas#add} overwrites a range that a command recorded
   * before the removal may still read.
   */
  public defragment(): void {
    if (this._deadVertexCount === 0 && this._deadIndexCount === 0) return;

    const stride = this.vertexStride;
    const vertexData = this._vertexBuffer.data;
    const indexData = this._indexBuffer.data;
    let writeVertex = 0;
    let writeIndex = 0;

    const rebase = this.rebaseIndices;

    // Iteration order = insertion order = offset order (bump allocator)
    for (const alloc of this._liveAllocations) {
      const oldBaseVertex = alloc.baseVertex;

      if (oldBaseVertex !== writeVertex) {
        const srcByte = oldBaseVertex * stride;
        const dstByte = writeVertex * stride;
        const byteLen = alloc.vertexCount * stride;
        vertexData.copyWithin(dstByte, srcByte, srcByte + byteLen);
        alloc.baseVertex = writeVertex;
      }
      writeVertex += alloc.vertexCount;

      if (alloc.firstIndex !== writeIndex) {
        indexData.copyWithin(writeIndex, alloc.firstIndex, alloc.firstIndex + alloc.indexCount);
        alloc.firstIndex = writeIndex;
      }

      // Fixup rebased indices when the vertex base shifted
      if (rebase && oldBaseVertex !== alloc.baseVertex) {
        const delta = alloc.baseVertex - oldBaseVertex;
        for (let i = 0; i < alloc.indexCount; i++) {
          indexData[alloc.firstIndex + i] += delta;
        }
      }

      writeIndex += alloc.indexCount;
    }

    this._markVertexDirty(0, writeVertex * stride);
    this._markIndexDirty(0, writeIndex);

    this._vertexCount = writeVertex;
    this._indexCount = writeIndex;
    this._deadVertexCount = 0;
    this._deadIndexCount = 0;
    this._bufferVersion++;
  }
}
