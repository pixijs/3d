import { describe, expect, it, vi } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';
import type { GeometryAllocation } from '~/geometry/GeometryAtlas';

type ViewConstructor = new (buffer: ArrayBufferLike, byteOffset: number, length: number) => ArrayLike<number>;

/** Reads one attribute of every vertex in an allocation, straight from the atlas buffer. */
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

/**
 * A positions-only geometry whose floats start `byteOffset` bytes into their buffer, after 0xff filler.
 *
 * The glTF loader returns tightly packed accessors like this, as views into the whole file's buffer.
 */
function makePositionsOnly(vertexCount: number, seed: number, byteOffset = 0): Geometry3D {
  const bytes = new Uint8Array(byteOffset + vertexCount * 12).fill(0xff);
  const positions = new Float32Array(bytes.buffer, byteOffset, vertexCount * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = seed + i * 0.25 - 3;

  return new Geometry3D({ positions });
}

describe('GeometryAtlas vertex copy', () => {
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

  it('copies an interleaved geometry in one block when its attribute order already matches the atlas', () => {
    const positions = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const uvs = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const geometry = new Geometry3D({ positions, uvs, interleave: true });

    const atlas = new GeometryAtlas({ referenceGeometry: geometry });
    for (const name of ['aPosition', 'aUV']) {
      expect(atlas.geometry.attributes[name].offset).toBe(geometry.attributes[name].offset);
      expect(atlas.vertexStride).toBe(geometry.attributes[name].stride);
    }

    const alloc = atlas.add(geometry);

    expect(readAttribute(alloc, 'aPosition', 3)).toEqual(Array.from(positions));
    expect(readAttribute(alloc, 'aUV', 2)).toEqual(Array.from(uvs));
  });

  it('gathers a byte-typed attribute next to float ones from separate buffers', () => {
    const positions = new Float32Array([0, 1, 2, 3, 4, 5]);
    const colors = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
    const geometry = new Geometry3D({ positions, colors });

    const atlas = new GeometryAtlas({ referenceGeometry: geometry });
    expect(atlas.vertexStride).toBe(16);

    const alloc = atlas.add(geometry);

    expect(readAttribute(alloc, 'aPosition', 3)).toEqual(Array.from(positions));
    expect(readAttribute(alloc, 'aColor', 4, Uint8Array)).toEqual(Array.from(colors));
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
