import { GlobalResourceRegistry } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { GeometryAtlas } from '~/geometry/GeometryAtlas';
import { GeometryAtlasPool } from '~/geometry/GeometryAtlasPool';

const makeTriangle = (): Geometry3D =>
  new Geometry3D({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  });

const makeAtlas = (reference: Geometry3D): GeometryAtlas =>
  new GeometryAtlas({ referenceGeometry: reference, initialVertexCapacity: 64, initialIndexCapacity: 64 });

describe('GeometryAtlas.add stale-allocation guard', () => {
  it('re-cuts an allocation left behind by a torn-down atlas', () => {
    const reference = makeTriangle();
    const shared = makeTriangle();

    const first = makeAtlas(reference);
    const firstAllocation = first.add(shared);
    expect(firstAllocation.atlas).toBe(first);

    first.destroy();

    const second = makeAtlas(reference);
    const secondAllocation = second.add(shared);

    expect(secondAllocation).not.toBe(firstAllocation);
    expect(secondAllocation.atlas).toBe(second);
    expect(shared._geometryAtlasAllocation).toBe(secondAllocation);

    second.destroy();
    shared.destroy(true);
    reference.destroy(true);
  });

  it('still early-returns for a geometry already in this atlas', () => {
    const reference = makeTriangle();
    const geometry = makeTriangle();
    const atlas = makeAtlas(reference);

    const allocation = atlas.add(geometry);
    const vertexCount = atlas.vertexCount;

    expect(atlas.add(geometry)).toBe(allocation);
    expect(atlas.vertexCount).toBe(vertexCount);

    atlas.destroy();
    geometry.destroy(true);
    reference.destroy(true);
  });
});

describe('GeometryAtlasPool.from', () => {
  it('keeps rebased and geometry-local index packing in separate pools', () => {
    const rebased = GeometryAtlasPool.from({ rebaseIndices: true });
    const geometryLocal = GeometryAtlasPool.from({ rebaseIndices: false });

    expect(rebased).not.toBe(geometryLocal);
  });

  it('hands every caller of one convention the same pool, so a geometry keeps one allocation', () => {
    const pool = GeometryAtlasPool.from({ rebaseIndices: false });
    const geometry = makeTriangle();

    const first = pool.allocate(geometry);
    const second = GeometryAtlasPool.from({ rebaseIndices: false }).allocate(geometry);

    expect(second).toBe(first);
    expect(geometry._geometryAtlasAllocation).toBe(first);

    geometry.destroy(true);
  });

  it("registers for pixi's opt-in global teardown", () => {
    expect(GlobalResourceRegistry.isRegistered(GeometryAtlasPool.from({ rebaseIndices: false }))).toBe(true);
    expect(GlobalResourceRegistry.isRegistered(GeometryAtlasPool.from({ rebaseIndices: true }))).toBe(true);
  });
});
