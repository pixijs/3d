import { Buffer, BufferUsage, getAttributeInfoFromFormat } from 'pixi.js';
import type { Attribute, TypedArray, VertexFormat } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { View3DPipe } from '~/core/View3DPipe';
import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';
import type { GeometryAllocation } from '~/geometry/GeometryAtlas';
import { Box } from '~/math/shapes/Box';
import { Vector3 } from '~/math/vector/Vector3';

type ViewConstructor = new (buffer: ArrayBufferLike, byteOffset: number, length: number) => ArrayLike<number>;

let nextRendererUid = 1;

class FakeGpu {
  public readonly renderer = { uid: nextRendererUid++, retire3d: { retire: () => {} } };
  public writes = 0;
  public copies = 0;
  private readonly _memory = new Map<Buffer, Uint8Array>();

  public bytes(buffer: Buffer): Uint8Array {
    let memory = this._memory.get(buffer);
    if (!memory) this._memory.set(buffer, (memory = new Uint8Array(buffer.descriptor.size)));
    return memory;
  }

  public get pipe(): View3DPipe {
    return this as unknown as View3DPipe;
  }

  public writeBuffer(buffer: Buffer, data: ArrayBufferView, offset: number): void {
    this.writes++;
    this.bytes(buffer).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
  }

  public copyBuffer(from: Buffer, to: Buffer, size: number, fromOffset: number, toOffset: number): void {
    this.copies++;
    this.bytes(to).set(this.bytes(from).subarray(fromOffset, fromOffset + size), toOffset);
  }

  public loseContext(atlas: GeometryAtlas): void {
    atlas.invalidateUploads(this.renderer.uid);
    this._memory.clear();
  }
}

function readAttribute(
  gpu: FakeGpu,
  alloc: GeometryAllocation,
  name: string,
  size: number,
  View: ViewConstructor = Float32Array,
): number[] {
  const { atlas } = alloc;
  const attr = atlas.geometry.attributes[name];
  const data = gpu.bytes(attr.buffer);
  const values: number[] = [];

  for (let v = 0; v < alloc.vertexCount; v++) {
    const byteOffset = data.byteOffset + (alloc.baseVertex + v) * atlas.vertexStride + (attr.offset ?? 0);
    values.push(...Array.from(new View(data.buffer, byteOffset, size)));
  }

  return values;
}

function makePositionsOnly(vertexCount: number, seed: number, byteOffset = 0): Geometry3D {
  const bytes = new Uint8Array(byteOffset + vertexCount * 12).fill(0xff);
  const positions = new Float32Array(bytes.buffer, byteOffset, vertexCount * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = seed + i * 0.25 - 3;

  return new Geometry3D({ positions });
}

function vertexAttribute(data: TypedArray, format: VertexFormat): Attribute {
  return { buffer: new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }), format };
}

function makeSeparateArrays(vertexCount: number, seed: number): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array(vertexCount * 3).map((_, i) => seed + i * 0.5 - 2),
    normals: new Float32Array(vertexCount * 3).map((_, i) => (i % 3 === 1 ? 0.997 : 0)),
    uvs: new Float32Array(vertexCount * 2).map((_, i) => (seed + i) / 16),
    colors: new Float32Array(vertexCount * 4).map((_, i) => (i % 4 === 3 ? 1 : (seed + i) / 32)),
  });
}

function makeQuantized(vertexCount: number, seed: number): Geometry3D {
  const bin = new ArrayBuffer(8 + vertexCount * 4);
  const uvs = new Uint16Array(bin, 8, vertexCount * 2);
  for (let i = 0; i < uvs.length; i++) uvs[i] = seed * 1000 + i * 2049;

  return new Geometry3D({
    positions: vertexAttribute(
      new Uint16Array(vertexCount * 4).map((_, i) => (i % 4 === 3 ? 0 : seed * 100 + i * 7)),
      'uint16x4',
    ),
    normals: vertexAttribute(
      new Int8Array(vertexCount * 4).map((_, i) => (i % 4 === 1 ? 127 : -seed - i)),
      'snorm8x4',
    ),
    uvs: vertexAttribute(uvs, 'unorm16x2'),
    bounds3D: new Box(new Vector3(0, 0, 0), new Vector3(65535, 65535, 65535)),
  });
}

function makeByteAligned(vertexCount: number, seed: number): Geometry3D {
  const bin = new ArrayBuffer(2 + vertexCount * 4);
  const colors = new Uint8Array(bin, 2, vertexCount * 4);
  for (let i = 0; i < colors.length; i++) colors[i] = seed * 50 + i * 9;

  return new Geometry3D({
    positions: new Float32Array(vertexCount * 3).map((_, i) => seed - i * 0.75),
    uvs: vertexAttribute(
      new Uint8Array(vertexCount * 2).map((_, i) => seed * 40 + i * 11),
      'unorm8x2',
    ),
    colors,
  });
}

describe('GeometryAtlas vertex copy', () => {
  it.each([
    { layout: 'separate float arrays with quantized normals', make: makeSeparateArrays },
    { layout: 'KHR_mesh_quantization', make: makeQuantized },
    { layout: '8-bit UVs and colours off a 4-byte boundary', make: makeByteAligned },
  ])('lands every attribute of $layout exactly, through atlas growth', ({ make }) => {
    const gpu = new FakeGpu();
    const atlas = new GeometryAtlas({ referenceGeometry: make(3, 0), initialVertexCapacity: 4 });
    const geometries = [make(3, 1), make(6, 2)];
    const allocations = [atlas.add(geometries[0])];
    atlas.update(gpu.pipe);
    allocations.push(atlas.add(geometries[1]));
    atlas.update(gpu.pipe);

    expect(atlas.geometry.attributes.aPosition.buffer.descriptor.size).toBeGreaterThan(4 * atlas.vertexStride);

    geometries.forEach((geometry, g) => {
      for (const [name, { buffer, format }] of Object.entries(geometry.attributes)) {
        const source = buffer.data;
        const View = source.constructor as ViewConstructor;
        const size = getAttributeInfoFromFormat(format!).size;

        expect(readAttribute(gpu, allocations[g], name, size, View), name).toEqual(Array.from(source));
      }
    });
  });

  it('copies a positions-only geometry byte for byte, wherever its data starts in its buffer', () => {
    const atlas = new GeometryAtlas({ referenceGeometry: makePositionsOnly(3, 0) });

    const first = makePositionsOnly(4, 0);
    const second = makePositionsOnly(5, 100, 64);
    const firstAlloc = atlas.add(first);
    const secondAlloc = atlas.add(second);
    const gpu = new FakeGpu();
    atlas.update(gpu.pipe);

    expect(readAttribute(gpu, firstAlloc, 'aPosition', 3)).toEqual(Array.from(first.positions));
    expect(readAttribute(gpu, secondAlloc, 'aPosition', 3)).toEqual(Array.from(second.positions));
  });

  it('places each attribute of an interleaved geometry that has the atlas stride but a different attribute order', () => {
    const positions = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const colors = new Float32Array([0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1, 0.7, 0.8, 0.9, 1]);
    const geometry = new Geometry3D({ positions, colors, interleave: true });

    const atlas = new GeometryAtlas({ referenceGeometry: geometry });
    expect(atlas.vertexStride).toBe(geometry.attributes.aPosition.stride);

    const alloc = atlas.add(geometry);
    const gpu = new FakeGpu();
    atlas.update(gpu.pipe);

    expect(readAttribute(gpu, alloc, 'aPosition', 3)).toEqual(Array.from(positions));
    expect(readAttribute(gpu, alloc, 'aColor', 4)).toEqual(Array.from(colors));
  });

  it('writes each geometry once, when it is added, and keeps no CPU copy of the atlas', () => {
    const gpu = new FakeGpu();
    const atlas = new GeometryAtlas({ referenceGeometry: makePositionsOnly(3, 0) });

    atlas.add(makePositionsOnly(4, 0));
    atlas.add(makePositionsOnly(5, 100));
    atlas.update(gpu.pipe);
    expect(gpu.writes).toBe(2);

    atlas.add(makePositionsOnly(2, 200));
    atlas.update(gpu.pipe);
    atlas.update(gpu.pipe);
    expect(gpu.writes).toBe(3);
    expect(atlas.geometry.attributes.aPosition.buffer.data).toBeFalsy();
  });

  it('fills a grown buffer with one GPU copy, writing only the geometry that grew it', () => {
    const gpu = new FakeGpu();
    const atlas = new GeometryAtlas({ referenceGeometry: makePositionsOnly(3, 0), initialVertexCapacity: 8 });
    const first = makePositionsOnly(4, 0);
    const second = makePositionsOnly(4, 50);
    const third = makePositionsOnly(6, 100);
    const firstAlloc = atlas.add(first);
    const secondAlloc = atlas.add(second);
    atlas.update(gpu.pipe);

    const thirdAlloc = atlas.add(third);
    atlas.update(gpu.pipe);

    expect(gpu.copies).toBe(1);
    expect(gpu.writes).toBe(3);
    expect(readAttribute(gpu, firstAlloc, 'aPosition', 3)).toEqual(Array.from(first.positions));
    expect(readAttribute(gpu, secondAlloc, 'aPosition', 3)).toEqual(Array.from(second.positions));
    expect(readAttribute(gpu, thirdAlloc, 'aPosition', 3)).toEqual(Array.from(third.positions));
  });

  it('copies the geometries a compaction moved, one copy per run that moved by the same amount', () => {
    const gpu = new FakeGpu();
    const atlas = new GeometryAtlas({ referenceGeometry: makePositionsOnly(3, 0), initialVertexCapacity: 16 });
    const geometries = [0, 1, 2, 3].map((g) => makePositionsOnly(4, g * 50));
    const allocations = geometries.map((geometry) => atlas.add(geometry));
    atlas.update(gpu.pipe);

    atlas.remove(geometries[1]);
    atlas.defragment();
    atlas.update(gpu.pipe);

    expect(gpu.copies, 'the first stays put and the last two move together').toBe(2);
    expect(gpu.writes).toBe(4);
    for (const g of [0, 2, 3]) {
      expect(readAttribute(gpu, allocations[g], 'aPosition', 3)).toEqual(Array.from(geometries[g].positions));
    }
  });

  it('gives a second renderer, and one whose context was lost, every geometry', () => {
    const first = new FakeGpu();
    const second = new FakeGpu();
    const atlas = new GeometryAtlas({ referenceGeometry: makePositionsOnly(3, 0), initialVertexCapacity: 8 });
    const geometries = [makePositionsOnly(4, 0), makePositionsOnly(4, 50)];
    const allocations = [atlas.add(geometries[0])];
    atlas.update(first.pipe);
    atlas.update(second.pipe);

    allocations.push(atlas.add(geometries[1]));
    atlas.update(first.pipe);
    atlas.update(second.pipe);
    second.loseContext(atlas);
    atlas.update(second.pipe);

    for (const gpu of [first, second]) {
      allocations.forEach((alloc, g) => {
        expect(readAttribute(gpu, alloc, 'aPosition', 3)).toEqual(Array.from(geometries[g].positions));
      });
    }
  });
});
