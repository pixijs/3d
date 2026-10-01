import { BufferUsage, getAttributeInfoFromFormat, Geometry, uid } from 'pixi.js';
import type { VertexFormat } from 'pixi.js';

import { Buffer3D } from '../core/buffers/Buffer3D';
import type { Geometry3D } from './Geometry3D';
import { alignTo4Bytes } from './utils/Geometry3DUtils';

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
  /** A geometry that defines the attribute layout; its data is not copied in, so call `add()` separately */
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
   * Bake `baseVertex` into the index values; see {@link GeometryAtlas#rebaseIndices}
   * @default false
   */
  rebaseIndices?: boolean;
}

/**
 * Packs {@link Geometry3D} instances that share an attribute layout into one vertex buffer and one
 * index buffer, so draws of different geometries don't rebind buffers
 *
 * Geometries must share the same {@link Geometry3D#attributeKey} to be packable together. Removed
 * allocations leave dead space until {@link GeometryAtlas#defragment} reclaims it.
 *
 * {@link GeometryAtlasPool} builds and owns every atlas. A {@link Geometry3DOptions#dynamic}
 * geometry never enters one.
 * @see {@link Geometry3D} For the per-mesh geometry that feeds the atlas
 * @internal
 */
export class GeometryAtlas {
  /** Unique ID for this atlas, used in sort keys */
  public readonly uid: number = uid('geometryAtlas');

  /** Attribute structure key shared by every geometry in this atlas */
  public readonly attributeKey: string;

  /** The vertex stride in bytes (same for all geometries in this atlas) */
  public readonly vertexStride: number = 0;

  private _vertexBuffer: Buffer3D;
  private _indexBuffer: Buffer3D;
  /**
   * Buffers that growth replaced
   *
   * Render bundles that other views recorded earlier in the frame still read them, so they live
   * until {@link GeometryAtlas#destroy}. Nothing else frees them: a {@link Buffer3D} is exempt
   * from pixi's GC.
   */
  private readonly _retiredBuffers: Buffer3D[] = [];
  /** Merged geometries that growth replaced, kept until {@link GeometryAtlas#destroy} like `_retiredBuffers` */
  private readonly _retiredGeometries: Geometry[] = [];
  private _vertexCount = 0;
  private _indexCount = 0;
  private _deadVertexCount = 0;
  private _deadIndexCount = 0;

  /**
   * Live allocations in offset order
   *
   * `add` appends at the end and `defragment` keeps the order, which its in-place slide relies on.
   */
  private readonly _liveAllocations: GeometryAllocation[] = [];

  private _vertexDirtyMin = Infinity;
  private _vertexDirtyMax = -Infinity;
  private _indexDirtyMin = Infinity;
  private _indexDirtyMax = -Infinity;

  /**
   * Bumped whenever draw commands recorded against this atlas go stale: when growth replaces a
   * buffer, and on every {@link GeometryAtlas#defragment}
   *
   * {@link GeometryAtlasPool#allocate} watches it to version the pool.
   * @internal
   */
  public _bufferVersion = 0;

  /** The PixiJS Geometry that wraps the merged vertex + index buffers used for draw calls */
  public geometry: Geometry;

  /**
   * Layout of each vertex attribute in the merged geometry, sorted by name
   *
   * Computed from the attribute formats alone, because the reference geometry may keep each
   * attribute in its own buffer.
   */
  private readonly _attributeInfo: { name: string; format: VertexFormat; offset: number; byteSize: number }[];

  /**
   * Whether {@link GeometryAtlas#add} bakes `baseVertex` into each index value
   *
   * WebGL 2 has no `baseVertex` draw parameter, so it packs rebased indices. WebGPU copies indices
   * as they are and passes `baseVertex` to `drawIndexed`.
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

    let computedStride = 0;

    this._attributeInfo = [];

    for (const name of sortedKeys) {
      const srcAttr = attrs[name];

      if (srcAttr.instance) continue;

      const format = srcAttr.format!;
      const byteSize = getAttributeInfoFromFormat(format).stride;

      computedStride = alignTo4Bytes(computedStride);
      const offset = computedStride;

      computedStride += byteSize;

      this._attributeInfo.push({ name, format, offset, byteSize });
    }

    this.vertexStride = alignTo4Bytes(computedStride);

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
   * attributes are rejected. A geometry already in this atlas gets its allocation back. One still
   * holding an allocation in another atlas, such as one {@link GeometryAtlasPool#clear} destroyed,
   * is copied in afresh.
   *
   * When the atlas is full it runs {@link GeometryAtlas#defragment}, and grows its buffers too if
   * the live data still doesn't fit. Vertex bytes copy in one block when the geometry already has
   * the atlas layout, and otherwise attribute by attribute through byte views, so nothing is
   * allocated per vertex.
   * @param geometry - The source mesh to merge in
   * @returns The allocation describing where the data lives in the merged buffers
   */
  public add(geometry: Geometry3D): GeometryAllocation {
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
    const dstByteOffset = baseVertex * vertexStride;
    const byteLength = vertexCount * vertexStride;

    if (this._matchesAtlasLayout(geometry)) {
      const src = geometry.attributes[this._attributeInfo[0].name].buffer.data;
      vertexData.set(new Uint8Array(src.buffer, src.byteOffset, byteLength), dstByteOffset);
    } else {
      for (const { name, offset, byteSize } of this._attributeInfo) {
        const attr = geometry.attributes[name];
        const data = attr.buffer.data;
        const srcBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const srcStride = attr.stride ?? byteSize;
        let src = attr.offset ?? 0;
        let dst = dstByteOffset + offset;

        for (let i = 0; i < vertexCount; i++) {
          for (let b = 0; b < byteSize; b++) vertexData[dst + b] = srcBytes[src + b];
          src += srcStride;
          dst += vertexStride;
        }
      }
    }

    this._markVertexDirty(dstByteOffset, dstByteOffset + byteLength);

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
   * The freed range is dead space until the next {@link GeometryAtlas#defragment}, which
   * {@link GeometryAtlas#add} runs when the atlas is full. Nothing rebuilds on
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

  /**
   * Whether `add` can copy the geometry's vertex bytes in one block
   *
   * True when every vertex attribute reads from one shared buffer at the atlas's stride and at
   * the atlas's offset for that attribute. Anything else takes the per-attribute copy.
   * @param geometry - The geometry being added
   */
  private _matchesAtlasLayout(geometry: Geometry3D): boolean {
    const attributes = geometry.attributes;
    const buffer = attributes[this._attributeInfo[0].name].buffer;

    for (const info of this._attributeInfo) {
      const attr = attributes[info.name];

      if (attr.buffer !== buffer || attr.stride !== this.vertexStride || (attr.offset ?? 0) !== info.offset) {
        return false;
      }
    }

    return true;
  }

  private _buildMergedGeometry(): Geometry {
    const geo = new Geometry();

    for (const { name, format, offset } of this._attributeInfo) {
      geo.addAttribute(name, { buffer: this._vertexBuffer, format, stride: this.vertexStride, offset });
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

  /** Moves the current merged geometry to `_retiredGeometries` ahead of a growth rebuild */
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

    this._retiredBuffers.push(this._vertexBuffer);

    this._vertexBuffer = new Buffer3D({
      data: newData,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      label: 'GeometryAtlas-vertex',
      shrinkToFit: false,
    });

    this._markVertexDirty(0, this._vertexCount * this.vertexStride);

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

    this._retiredBuffers.push(this._indexBuffer);

    this._indexBuffer = new Buffer3D({
      data: newData,
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      label: 'GeometryAtlas-index',
      shrinkToFit: false,
    });

    this._markIndexDirty(0, this._indexCount);

    this._retireCurrentGeometry();
    this.geometry = this._buildMergedGeometry();
    this._bufferVersion++;
  }

  /**
   * Frees the GPU resources this atlas owns: its buffers and merged geometry, and the ones growth
   * replaced
   *
   * Called by {@link GeometryAtlasPool#clear}. The merged geometries are destroyed without their
   * buffers, and each buffer is then destroyed once. The geometries packed into the atlas are left
   * alone and keep their allocations here, so the next {@link GeometryAtlas#add} into another
   * atlas copies them in afresh. A second call does nothing.
   */
  public destroy(): void {
    if (this._vertexBuffer === null) return;

    if (this.geometry) this.geometry.indexBuffer = null!;
    this.geometry?.destroy(false);
    this.geometry = null!;

    this._vertexBuffer.destroy();
    this._indexBuffer.destroy();

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
   * Compacts the vertex and index buffers by sliding live allocations down over the gaps that
   * removed geometries left
   *
   * Updates every live allocation's offsets in place, so whoever holds one sees the new offsets.
   * Does nothing when there is no dead space.
   *
   * Every compaction bumps `_bufferVersion`, as growth does, because it always leaves recorded draw
   * commands stale. A slide moves live allocations away from the `baseVertex` / `firstIndex` those
   * commands bake. Dead space only at the tail still shrinks the live extent, so the next
   * {@link GeometryAtlas#add} overwrites a range that a command recorded before the removal may
   * still read.
   */
  public defragment(): void {
    if (this._deadVertexCount === 0 && this._deadIndexCount === 0) return;

    const stride = this.vertexStride;
    const vertexData = this._vertexBuffer.data;
    const indexData = this._indexBuffer.data;
    let writeVertex = 0;
    let writeIndex = 0;

    const rebase = this.rebaseIndices;

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
