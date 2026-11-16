import { BufferUsage, getAttributeInfoFromFormat, Geometry, uid } from 'pixi.js';
import type { VertexFormat } from 'pixi.js';

import { Buffer3D } from '../core/buffers/Buffer3D';
import type { View3DPipe } from '../core/View3DPipe';
import type { Geometry3D } from './Geometry3D';
import { alignTo4Bytes } from './utils/Geometry3DUtils';

/** @internal */
export interface GeometryAllocation {
  atlas: GeometryAtlas;
  baseVertex: number;
  firstIndex: number;
  indexCount: number;
  vertexCount: number;
  /** The one CPU copy of its vertices, which every upload interleaves afresh */
  geometry: Geometry3D;
  /** Counts `add` calls, so a renderer knows which allocations the buffer it filled already holds */
  seq: number;
  /** Its `baseVertex` in the atlas's copy source, or -1 if it was added after that buffer was replaced */
  copyFrom: number;
}

const DEFAULT_VERTEX_CAPACITY = 1024;
const DEFAULT_INDEX_CAPACITY = 2048;

interface GeometryAtlasOptions {
  referenceGeometry: Geometry3D;
  initialVertexCapacity?: number;
  initialIndexCapacity?: number;
  rebaseIndices?: boolean;
  maxBufferBytes?: number;
}

/** @internal */
export class GeometryAtlas {
  public readonly uid: number = uid('geometryAtlas');

  public readonly attributeKey: string;

  public readonly vertexStride: number = 0;

  private _vertexBuffer: Buffer3D;
  private _vertexCapacity = 0;
  /** Whether a renderer has written to `_vertexBuffer`, so a replacement can copy from it */
  private _vertexBufferFilled = false;
  /** The newest replaced vertex buffer a renderer filled, which that renderer copies from; null once handed to `retire3d` */
  private _copySource: Buffer3D | null = null;
  private _seq = 0;
  /** Per renderer uid, the vertex buffer it last filled and the newest allocation `seq` in it */
  private readonly _filled: Record<number, { bufferUid: number; seq: number }> = Object.create(null);
  private _indexBuffer: Buffer3D;
  /** What growth and compaction replaced since the last `update`, which hands it to its renderer's `retire3d` */
  private readonly _replaced: { destroy(): void }[] = [];
  private _vertexCount = 0;
  private _indexCount = 0;
  private _deadVertexCount = 0;
  private _deadIndexCount = 0;

  /** In offset order, which `defragment`'s in-place slide relies on */
  private readonly _liveAllocations: GeometryAllocation[] = [];

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

  /** WebGPU's `maxBufferSize`: a bigger buffer is invalid, and so is every command buffer that draws from it */
  public maxBufferBytes = Infinity;

  constructor(options: GeometryAtlasOptions) {
    const {
      referenceGeometry,
      initialVertexCapacity = DEFAULT_VERTEX_CAPACITY,
      initialIndexCapacity = DEFAULT_INDEX_CAPACITY,
      rebaseIndices = false,
      maxBufferBytes = Infinity,
    } = options;

    this.rebaseIndices = rebaseIndices;
    this.maxBufferBytes = maxBufferBytes;

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

    this._vertexBuffer = this._createVertexBuffer(initialVertexCapacity);

    this._indexBuffer = new Buffer3D({
      data: new Uint32Array(initialIndexCapacity),
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      label: 'GeometryAtlas-index',
      shrinkToFit: false,
    });

    this.geometry = this._buildMergedGeometry();
  }

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

    const vertexCapacity = this._vertexCapacity;
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

    const indexData = this._indexBuffer.data;

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
      geometry,
      seq: ++this._seq,
      copyFrom: -1,
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

  /** Makes the next `update` for that renderer write everything, since its buffers came back empty or went with it */
  public invalidateUploads(rendererUid: number): void {
    delete this._filled[rendererUid];
  }

  /** Brings the pipe's renderer's copy of the vertex buffer up to date, then uploads the indices this frame's `add` calls wrote */
  public update(pipe: View3DPipe): void {
    this._uploadVertices(pipe);

    if (this._replaced.length > 0) {
      for (const resource of this._replaced) pipe.renderer.retire3d.retire(resource);
      this._replaced.length = 0;
      this._copySource = null;
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
   * Copies what the renderer's filled buffer already holds when the atlas replaced it, and writes every allocation
   * newer than that; one it never filled, or one already freed, gets every allocation written
   */
  private _uploadVertices(pipe: View3DPipe): void {
    const buffer = this._vertexBuffer;
    const filled = this._filled[pipe.renderer.uid];
    if (filled && filled.bufferUid === buffer.uid && filled.seq === this._seq) return;

    let held = 0;

    if (filled?.bufferUid === buffer.uid) {
      held = filled.seq;
    } else if (filled && filled.bufferUid === this._copySource?.uid) {
      this._copyHeld(pipe, filled.seq);
      held = filled.seq;
    }

    for (const alloc of this._liveAllocations) {
      if (alloc.seq > held)
        pipe.writeBuffer(buffer, this._vertexBytes(alloc.geometry), alloc.baseVertex * this.vertexStride);
    }

    if (filled) {
      filled.bufferUid = buffer.uid;
      filled.seq = this._seq;
    } else {
      this._filled[pipe.renderer.uid] = { bufferUid: buffer.uid, seq: this._seq };
    }

    this._vertexBufferFilled = true;
  }

  /**
   * One copy per run of allocations that moved by the same amount, the dead space between them included. Writes
   * after it land on whatever such a copy put where newer allocations sit
   */
  private _copyHeld(pipe: View3DPipe, held: number): void {
    const from = this._copySource!;
    const stride = this.vertexStride;
    let start = -1;
    let end = 0;
    let shift = 0;

    for (const alloc of this._liveAllocations) {
      if (alloc.seq > held) continue;

      const allocShift = alloc.baseVertex - alloc.copyFrom;

      if (start >= 0 && allocShift === shift) {
        end = alloc.copyFrom + alloc.vertexCount;
        continue;
      }

      if (start >= 0)
        pipe.copyBuffer(from, this._vertexBuffer, (end - start) * stride, start * stride, (start + shift) * stride);

      start = alloc.copyFrom;
      end = start + alloc.vertexCount;
      shift = allocShift;
    }

    if (start >= 0)
      pipe.copyBuffer(from, this._vertexBuffer, (end - start) * stride, start * stride, (start + shift) * stride);
  }

  /**
   * A geometry's vertices in the atlas layout: its own buffer when that already is, else interleaved through
   * `Uint32Array` views, as a float copy alters quantized normals that read as NaN. The word copy is unrolled to four
   * words, the largest vertex format, because that beats an inner loop
   */
  private _vertexBytes(geometry: Geometry3D): Uint8Array {
    const vertexCount = geometry.vertexCount;
    const vertexStride = this.vertexStride;
    const byteLength = vertexCount * vertexStride;

    if (this._matchesAtlasLayout(geometry)) {
      const src = geometry.attributes[this._attributeInfo[0].name].buffer.data;
      return new Uint8Array(src.buffer, src.byteOffset, byteLength);
    }

    const vertexData = new Uint8Array(byteLength);
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
        let dst = offset >> 2;

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
        let dst = offset;

        for (let i = 0; i < vertexCount; i++) {
          for (let b = 0; b < byteSize; b++) vertexData[dst + b] = srcBytes[src + b];
          src += srcStride;
          dst += vertexStride;
        }
      }
    }

    return vertexData;
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

  /**
   * Sets every attribute's `instance`, since pixi fills it in only for the attributes the first program to draw the
   * geometry reads, which would key a rebuilt merged geometry's pipelines differently when a depth-only program drew it first
   */
  private _buildMergedGeometry(): Geometry {
    const geo = new Geometry();

    for (const { name, format, offset } of this._attributeInfo) {
      geo.addAttribute(name, {
        buffer: this._vertexBuffer,
        format,
        stride: this.vertexStride,
        offset,
        instance: false,
      });
    }

    geo.addIndex(this._indexBuffer);

    return geo;
  }

  private _markIndexDirty(startIndex: number, endIndex: number): void {
    if (startIndex < this._indexDirtyMin) this._indexDirtyMin = startIndex;
    if (endIndex > this._indexDirtyMax) this._indexDirtyMax = endIndex;
  }

  private _retireCurrentGeometry(): void {
    if (this.geometry) {
      this.geometry.indexBuffer = null!;
      this._replaced.push(this.geometry);
    }
  }

  /** Counts dead ranges as room, since `add` compacts them before it grows */
  public fits(geometry: Geometry3D): boolean {
    const vertices = this._vertexCount - this._deadVertexCount + geometry.vertexCount;
    const indices = this._indexCount - this._deadIndexCount + geometry.indexBuffer.data.length;

    return vertices * this.vertexStride <= this.maxBufferBytes && indices * 4 <= this.maxBufferBytes;
  }

  private _ensureVertexCapacity(requiredVertices: number): void {
    let capacity = this._vertexCapacity;
    if (requiredVertices <= capacity) return;

    while (capacity < requiredVertices) capacity *= 2;
    capacity = Math.max(requiredVertices, Math.min(capacity, Math.floor(this.maxBufferBytes / this.vertexStride)));

    this._replaceVertexBuffer(capacity);
  }

  private _createVertexBuffer(capacity: number): Buffer3D {
    this._vertexCapacity = capacity;

    return new Buffer3D({
      size: capacity * this.vertexStride,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST | BufferUsage.COPY_SRC,
      label: 'GeometryAtlas-vertex',
      shrinkToFit: false,
    });
  }

  /**
   * Call it before moving any allocation, so `copyFrom` records where each one sits in the buffer being replaced. A
   * buffer no renderer filled keeps the older copy source and its `copyFrom` values, which still describe that one
   */
  private _replaceVertexBuffer(capacity: number): void {
    if (this._vertexBufferFilled) {
      this._copySource = this._vertexBuffer;
      for (const alloc of this._liveAllocations) alloc.copyFrom = alloc.baseVertex;
    }

    this._replaced.push(this._vertexBuffer);
    this._vertexBuffer = this._createVertexBuffer(capacity);
    this._vertexBufferFilled = false;

    this._retireCurrentGeometry();
    this.geometry = this._buildMergedGeometry();
    this._bufferVersion++;
  }

  private _ensureIndexCapacity(requiredIndices: number): void {
    const oldData = this._indexBuffer.data;
    let capacity = oldData.length;
    if (requiredIndices <= capacity) return;

    while (capacity < requiredIndices) capacity *= 2;
    capacity = Math.max(requiredIndices, Math.min(capacity, Math.floor(this.maxBufferBytes / 4)));

    const newData = new Uint32Array(capacity);
    newData.set(oldData);

    this._replaced.push(this._indexBuffer);

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

    for (const resource of this._replaced) resource.destroy();
    (this._replaced as { destroy(): void }[] | null) = null;

    this._vertexBuffer = null!;
    this._indexBuffer = null!;
    this._copySource = null;

    (this._liveAllocations as GeometryAllocation[] | null) = null;
  }

  /**
   * Updates live allocations in place, and bumps `_bufferVersion` even for dead space only at the tail, which
   * the next `add` overwrites while recorded commands may still read it. Moved vertices go to a fresh buffer, which
   * renderers fill with GPU copies, since neither API copies within one buffer over overlapping ranges
   */
  public defragment(): void {
    if (this._deadVertexCount === 0 && this._deadIndexCount === 0) return;

    let writeVertex = 0;

    for (const alloc of this._liveAllocations) {
      if (alloc.baseVertex !== writeVertex) {
        this._replaceVertexBuffer(this._vertexCapacity);
        break;
      }
      writeVertex += alloc.vertexCount;
    }

    const indexData = this._indexBuffer.data;
    let writeIndex = 0;
    writeVertex = 0;

    const rebase = this.rebaseIndices;

    for (const alloc of this._liveAllocations) {
      const oldBaseVertex = alloc.baseVertex;

      alloc.baseVertex = writeVertex;
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

    this._markIndexDirty(0, writeIndex);

    this._vertexCount = writeVertex;
    this._indexCount = writeIndex;
    this._deadVertexCount = 0;
    this._deadIndexCount = 0;
    this._bufferVersion++;
  }
}
