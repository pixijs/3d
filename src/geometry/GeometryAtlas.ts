import { BufferUsage, getAttributeInfoFromFormat, Geometry, uid } from 'pixi.js';
import type { VertexFormat, WebGLRenderer, WebGPURenderer } from 'pixi.js';

import { Buffer3D } from '../core/buffers/Buffer3D';
import { retire } from '../core/RetireSystem';
import type { Geometry3D } from './Geometry3D';
import { alignTo4Bytes } from './utils/Geometry3DUtils';

/** @internal */
export interface GeometryAllocation {
  atlas: GeometryAtlas;
  baseVertex: number;
  firstIndex: number;
  indexCount: number;
  vertexCount: number;
  /** The one CPU copy of its vertices and indices, which every upload interleaves or rebases afresh */
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
  /** The newest replaced vertex buffer a renderer filled, which renderers that filled it copy from until it's destroyed */
  private _copySource: Buffer3D | null = null;
  private _seq = 0;
  /** Per renderer uid, the vertex and index buffers it last filled and the newest allocation `seq` in them */
  private readonly _filled: Record<number, { vertexBufferUid: number; indexBufferUid: number; seq: number }> =
    Object.create(null);
  private _indexBuffer: Buffer3D;
  private _indexCapacity = 0;
  private _vertexCount = 0;
  private _indexCount = 0;
  private _deadVertexCount = 0;
  private _deadIndexCount = 0;

  /** In offset order, which `defragment`'s in-place slide relies on */
  private readonly _liveAllocations: GeometryAllocation[] = [];

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
    this._indexBuffer = this._createIndexBuffer(initialIndexCapacity);

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
    const indexCount = geometry.indexBuffer.data.length;

    const vertexCapacity = this._vertexCapacity;
    const indexCapacity = this._indexCapacity;

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

  /** Brings the renderer's copies of the vertex and index buffers up to date */
  public update(renderer: WebGLRenderer | WebGPURenderer): void {
    const vertexBuffer = this._vertexBuffer;
    const indexBuffer = this._indexBuffer;
    const filled = this._filled[renderer.uid];

    if (
      filled &&
      filled.vertexBufferUid === vertexBuffer.uid &&
      filled.indexBufferUid === indexBuffer.uid &&
      filled.seq === this._seq
    ) {
      return;
    }

    this._uploadVertices(renderer, filled);
    this._uploadIndices(renderer, filled);

    if (filled) {
      filled.vertexBufferUid = vertexBuffer.uid;
      filled.indexBufferUid = indexBuffer.uid;
      filled.seq = this._seq;
    } else {
      this._filled[renderer.uid] = {
        vertexBufferUid: vertexBuffer.uid,
        indexBufferUid: indexBuffer.uid,
        seq: this._seq,
      };
    }

    this._vertexBufferFilled = true;
  }

  /**
   * Copies what the renderer's filled buffer already holds when the atlas replaced it, and writes every allocation
   * newer than that; one it never filled, or one already freed, gets every allocation written
   */
  private _uploadVertices(
    renderer: WebGLRenderer | WebGPURenderer,
    filled: { vertexBufferUid: number; seq: number } | undefined,
  ): void {
    const buffer = this._vertexBuffer;
    if (this._copySource?.destroyed) this._copySource = null;

    let held = 0;

    if (filled?.vertexBufferUid === buffer.uid) {
      held = filled.seq;
    } else if (filled && filled.vertexBufferUid === this._copySource?.uid) {
      this._copyHeld(renderer, filled.seq);
      held = filled.seq;
    }

    for (const alloc of this._liveAllocations) {
      if (alloc.seq > held)
        renderer.buffer.write(buffer, this._vertexBytes(alloc.geometry), alloc.baseVertex * this.vertexStride);
    }
  }

  /**
   * Writes the indices of every allocation from the first one the renderer's filled buffer lacks to the end, in one
   * call, since allocations sit in `seq` order; a buffer it never filled gets every allocation written. Each comes
   * from its geometry, widened to `uint32` and rebased when `rebaseIndices`, so dead space between them reads 0
   */
  private _uploadIndices(
    renderer: WebGLRenderer | WebGPURenderer,
    filled: { indexBufferUid: number; seq: number } | undefined,
  ): void {
    const allocations = this._liveAllocations;
    let first = 0;

    if (filled?.indexBufferUid === this._indexBuffer.uid) {
      first = allocations.length;
      for (let i = 0; i < allocations.length; i++) {
        if (allocations[i].seq > filled.seq) {
          first = i;
          break;
        }
      }
    }

    if (first === allocations.length) return;

    const from = allocations[first].firstIndex;
    const indices = new Uint32Array(this._indexCount - from);

    for (let i = first; i < allocations.length; i++) {
      const alloc = allocations[i];
      const source = alloc.geometry.indexBuffer.data;
      const offset = alloc.firstIndex - from;

      if (this.rebaseIndices) {
        for (let j = 0; j < alloc.indexCount; j++) indices[offset + j] = source[j] + alloc.baseVertex;
      } else {
        indices.set(source, offset);
      }
    }

    renderer.buffer.write(this._indexBuffer, indices, from * 4);
  }

  /**
   * One copy per run of allocations that moved by the same amount, the dead space between them included. Writes
   * after it land on whatever such a copy put where newer allocations sit
   */
  private _copyHeld(renderer: WebGLRenderer | WebGPURenderer, held: number): void {
    const from = this._copySource!;
    const to = this._vertexBuffer;
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

      if (start >= 0) renderer.buffer.copy(from, to, (end - start) * stride, start * stride, (start + shift) * stride);

      start = alloc.copyFrom;
      end = start + alloc.vertexCount;
      shift = allocShift;
    }

    if (start >= 0) renderer.buffer.copy(from, to, (end - start) * stride, start * stride, (start + shift) * stride);
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

  private _retireCurrentGeometry(): void {
    if (this.geometry) {
      this.geometry.indexBuffer = null!;
      retire(this.geometry);
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

    retire(this._vertexBuffer);
    this._vertexBuffer = this._createVertexBuffer(capacity);
    this._vertexBufferFilled = false;

    this._retireCurrentGeometry();
    this.geometry = this._buildMergedGeometry();
    this._bufferVersion++;
  }

  private _ensureIndexCapacity(requiredIndices: number): void {
    let capacity = this._indexCapacity;
    if (requiredIndices <= capacity) return;

    while (capacity < requiredIndices) capacity *= 2;
    capacity = Math.max(requiredIndices, Math.min(capacity, Math.floor(this.maxBufferBytes / 4)));

    this._replaceIndexBuffer(capacity);
  }

  /** Size-only like the vertex buffer: renderers get the indices from each allocation's geometry through `update` */
  private _createIndexBuffer(capacity: number): Buffer3D {
    this._indexCapacity = capacity;

    return new Buffer3D({
      size: capacity * 4,
      usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
      indexFormat: 'uint32',
      label: 'GeometryAtlas-index',
      shrinkToFit: false,
    });
  }

  /**
   * Never rewrites the buffer it replaces, which draws recorded earlier this frame may still read; every renderer
   * then writes the new one in full on its next `update`
   */
  private _replaceIndexBuffer(capacity: number): void {
    retire(this._indexBuffer);
    this._indexBuffer = this._createIndexBuffer(capacity);

    this._retireCurrentGeometry();
    this.geometry = this._buildMergedGeometry();
    this._bufferVersion++;
  }

  /**
   * Destroys the merged geometry without its buffers, which it shares, then each buffer once; what growth replaced
   * goes with the `retire` list. Packed geometries keep their allocations here, so `add` into another atlas copies
   * them in afresh
   */
  public destroy(): void {
    if (this._vertexBuffer === null) return;

    if (this.geometry) this.geometry.indexBuffer = null!;
    this.geometry?.destroy(false);
    this.geometry = null!;

    this._vertexBuffer.destroy();
    this._indexBuffer.destroy();

    this._vertexBuffer = null!;
    this._indexBuffer = null!;
    this._copySource = null;

    (this._liveAllocations as GeometryAllocation[] | null) = null;
  }

  /**
   * Updates live allocations in place, and bumps `_bufferVersion` even for dead space only at the tail, which
   * the next `add` overwrites while recorded commands may still read it. Moved vertices and indices go to fresh
   * buffers, which earlier draws this frame don't read; renderers fill the vertex one with GPU copies, since neither
   * API copies within one buffer over overlapping ranges, and rewrite the index one from the geometries
   */
  public defragment(): void {
    if (this._deadVertexCount === 0 && this._deadIndexCount === 0) return;

    let writeVertex = 0;
    let writeIndex = 0;
    let verticesMove = false;
    let indicesMove = false;

    for (const alloc of this._liveAllocations) {
      verticesMove ||= alloc.baseVertex !== writeVertex;
      indicesMove ||= alloc.firstIndex !== writeIndex;
      writeVertex += alloc.vertexCount;
      writeIndex += alloc.indexCount;
    }

    if (verticesMove) this._replaceVertexBuffer(this._vertexCapacity);
    if (indicesMove || (this.rebaseIndices && verticesMove)) this._replaceIndexBuffer(this._indexCapacity);

    writeVertex = 0;
    writeIndex = 0;

    for (const alloc of this._liveAllocations) {
      alloc.baseVertex = writeVertex;
      alloc.firstIndex = writeIndex;
      writeVertex += alloc.vertexCount;
      writeIndex += alloc.indexCount;
    }

    this._vertexCount = writeVertex;
    this._indexCount = writeIndex;
    this._deadVertexCount = 0;
    this._deadIndexCount = 0;
    this._bufferVersion++;
  }
}
