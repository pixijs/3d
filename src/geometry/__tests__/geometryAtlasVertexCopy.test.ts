import { Buffer, BufferUsage, getAttributeInfoFromFormat } from 'pixi.js';
import type { Attribute, TypedArray, VertexFormat } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';
import type { GeometryAllocation } from '~/geometry/GeometryAtlas';
import { Box } from '~/math/shapes/Box';
import { Vector3 } from '~/math/vector/Vector3';

type ViewConstructor = new (buffer: ArrayBufferLike, byteOffset: number, length: number) => ArrayLike<number>;

function readAttribute(
  alloc: GeometryAllocation,
  name: string,
  size: number,
  View: ViewConstructor = Float32Array,
): number[] {
  const { atlas } = alloc;
  const attr = atlas.geometry.attributes[name];
  const data = attr.buffer.data;
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
    const atlas = new GeometryAtlas({ referenceGeometry: make(3, 0), initialVertexCapacity: 4 });
    const geometries = [make(3, 1), make(6, 2)];
    const allocations = geometries.map((geometry) => atlas.add(geometry));

    expect(atlas.geometry.attributes.aPosition.buffer.data.byteLength).toBeGreaterThan(4 * atlas.vertexStride);

    geometries.forEach((geometry, g) => {
      for (const [name, { buffer, format }] of Object.entries(geometry.attributes)) {
        const source = buffer.data;
        const View = source.constructor as ViewConstructor;
        const size = getAttributeInfoFromFormat(format!).size;

        expect(readAttribute(allocations[g], name, size, View), name).toEqual(Array.from(source));
      }
    });
  });

  it('copies a positions-only geometry byte for byte, wherever its data starts in its buffer', () => {
    const atlas = new GeometryAtlas({ referenceGeometry: makePositionsOnly(3, 0) });

    const first = makePositionsOnly(4, 0);
    const second = makePositionsOnly(5, 100, 64);
    const firstAlloc = atlas.add(first);
    const secondAlloc = atlas.add(second);

    expect(readAttribute(firstAlloc, 'aPosition', 3)).toEqual(Array.from(first.positions));
    expect(readAttribute(secondAlloc, 'aPosition', 3)).toEqual(Array.from(second.positions));
  });

  it('places each attribute of an interleaved geometry that has the atlas stride but a different attribute order', () => {
    const positions = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const colors = new Float32Array([0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1, 0.7, 0.8, 0.9, 1]);
    const geometry = new Geometry3D({ positions, colors, interleave: true });

    const atlas = new GeometryAtlas({ referenceGeometry: geometry });
    expect(atlas.vertexStride).toBe(geometry.attributes.aPosition.stride);

    const alloc = atlas.add(geometry);

    expect(readAttribute(alloc, 'aPosition', 3)).toEqual(Array.from(positions));
    expect(readAttribute(alloc, 'aColor', 4)).toEqual(Array.from(colors));
  });

  it('uploads the vertex bytes each add wrote as one range, then nothing until the next add', () => {
    const atlas = new GeometryAtlas({ referenceGeometry: makePositionsOnly(3, 0) });
    const update = vi.spyOn(atlas.geometry.attributes.aPosition.buffer, 'update');

    atlas.add(makePositionsOnly(4, 0));
    atlas.add(makePositionsOnly(5, 100));
    atlas.update();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith(9 * 12, 0);

    atlas.add(makePositionsOnly(2, 200));
    atlas.update();
    atlas.update();

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(2 * 12, 9 * 12);
  });
});
