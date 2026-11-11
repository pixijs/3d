import { BufferUsage, getAttributeInfoFromFormat, Geometry, uid } from 'pixi.js';
import type { VertexFormat } from 'pixi.js';

import { Buffer3D } from '../core/buffers/Buffer3D';
import type { Geometry3D } from './Geometry3D';
import { alignTo4Bytes } from './utils/Geometry3DUtils';

/** @internal */
export interface GeometryAllocation {
  atlas: GeometryAtlas;
  baseVertex: number;
  firstIndex: number;
  indexCount: number;
  vertexCount: number;
}

const DEFAULT_VERTEX_CAPACITY = 1024;
const DEFAULT_INDEX_CAPACITY = 2048;

interface GeometryAtlasOptions {
  referenceGeometry: Geometry3D;
  initialVertexCapacity?: number;
  initialIndexCapacity?: number;
  rebaseIndices?: boolean;
}

/** @internal */
export class GeometryAtlas {
  public readonly uid: number = uid('geometryAtlas');

  public readonly attributeKey: string;

  public readonly vertexStride: number = 0;

  private _vertexBuffer: Buffer3D;
  private _indexBuffer: Buffer3D;
  /** Buffers growth replaced, kept until `destroy` because draws recorded earlier in the frame may still read them */
  private readonly _retiredBuffers: Buffer3D[] = [];
  /** Kept until `destroy`, like `_retiredBuffers` */
  private readonly _retiredGeometries: Geometry[] = [];
  private _vertexCount = 0;
  private _indexCount = 0;
  private _deadVertexCount = 0;
  private _deadIndexCount = 0;

  /** In offset order, which `defragment`'s in-place slide relies on */
  private readonly _liveAllocations: GeometryAllocation[] = [];

  private _vertexDirtyMin = Infinity;
  private _vertexDirtyMax = -Infinity;
  private _indexDirtyMin = Infinity;
  private _indexDirtyMax = -Infinity;

  /**
   * Bumped when growth or a compaction leaves draw commands recorded against the atlas stale
   * @internal
   */
  public _bufferVersion = 0;

  public geometry: Geometry;

  private readonly _attributeInfo: { name: string; format: VertexFormat; offset: number; byteSize: number }[];

  /** Whether `add` bakes `baseVertex` into the index values, for WebGL 2, which has no `baseVertex` draw parameter */
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

  /**
   * Copies through `Uint32Array` views, as a float copy alters quantized normals that read as NaN. The
   * word copy is unrolled to four words, the largest vertex format, because that beats an inner loop
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
      const vertexWords = new Uint32Array(vertexData.buffer);

      for (const { name, offset, byteSize } of this._attributeInfo) {
        const attr = geometry.attributes[name];
        const data = attr.buffer.data;
        const srcStride = attr.stride ?? byteSize;
        const srcOffset = attr.offset ?? 0;

        if (((data.byteOffset | srcOffset | srcStride | byteSize) & 3) === 0) {
          const srcWords = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
          const srcStep = srcStride >> 2;
          const dstStep = vertexStride >> 2;
          let src = srcOffset >> 2;
          let dst = (dstByteOffset + offset) >> 2;

          for (let i = 0; i < vertexCount; i++) {
            vertexWords[dst] = srcWords[src];
            if (byteSize > 4) vertexWords[dst + 1] = srcWords[src + 1];
            if (byteSize > 8) vertexWords[dst + 2] = srcWords[src + 2];
            if (byteSize > 12) vertexWords[dst + 3] = srcWords[src + 3];
            src += srcStep;
            dst += dstStep;
          }
        } else {
          const srcBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          let src = srcOffset;
          let dst = dstByteOffset + offset;

          for (let i = 0; i < vertexCount; i++) {
            for (let b = 0; b < byteSize; b++) vertexData[dst + b] = srcBytes[src + b];
            src += srcStride;
            dst += vertexStride;
          }
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
    geometry._atlasVacated = false;
    this._liveAllocations.push(allocation);
    return allocation;
  }

  /**
   * Doesn't version the atlas, since the range keeps its bytes until a compaction; on a destroyed atlas it only
   * clears the geometry's allocation
   */
  public remove(geometry: Geometry3D): void {
    const alloc = geometry._geometryAtlasAllocation;
    if (!alloc) return;

    geometry._geometryAtlasAllocation = null;
    geometry._atlasVacated = true;
    if (this._vertexBuffer === null) return;

    this._deadVertexCount += alloc.vertexCount;
    this._deadIndexCount += alloc.indexCount;

    const idx = this._liveAllocations.indexOf(alloc);
    if (idx !== -1) this._liveAllocations.splice(idx, 1);
  }

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
   * Destroys the merged geometries without their buffers, which they share, then each buffer once. Packed
   * geometries keep their allocations here, so `add` into another atlas copies them in afresh
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
    (this._retiredGeometries as Geometry[] | null) = null;

    for (let i = 0; i < this._retiredBuffers.length; i++) {
      this._retiredBuffers[i].destroy();
    }
    (this._retiredBuffers as Buffer3D[] | null) = null;

    this._vertexBuffer = null!;
    this._indexBuffer = null!;

    (this._liveAllocations as GeometryAllocation[] | null) = null;
  }

  /**
   * Updates live allocations in place, and bumps `_bufferVersion` even for dead space only at the tail, which
   * the next `add` overwrites while recorded commands may still read it
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
