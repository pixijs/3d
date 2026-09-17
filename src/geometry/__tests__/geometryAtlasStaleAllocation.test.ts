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

    // A renderer going away takes its atlas with it, but process-wide shared
    // geometry (the Sprite3D quad) outlives it still holding the allocation.
    first.destroy();

    const second = makeAtlas(reference);
    const secondAllocation = second.add(shared);

    // Reusing the stale allocation would draw the geometry from the freed atlas's
    // buffers.
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
  it('hands every caller the same pool for one packing convention', () => {
    expect(GeometryAtlasPool.from({ rebaseIndices: false })).toBe(GeometryAtlasPool.from({ rebaseIndices: false }));
    expect(GeometryAtlasPool.from({ rebaseIndices: true })).toBe(GeometryAtlasPool.from({ rebaseIndices: true }));
  });

  it('keeps the two conventions apart', () => {
    // WebGL bakes baseVertex into index values, WebGPU leaves them
    // geometry-local, so the packed bytes differ and the pools cannot be one.
    const rebased = GeometryAtlasPool.from({ rebaseIndices: true });
    const geometryLocal = GeometryAtlasPool.from({ rebaseIndices: false });

    expect(rebased).not.toBe(geometryLocal);
  });

  it('reuses one allocation across pools of the same convention', () => {
    const pool = GeometryAtlasPool.from({ rebaseIndices: false });
    const geometry = makeTriangle();

    // Two renderers on one backend reach the same pool, so the geometry's single
    // `_geometryAtlasAllocation` stays valid instead of being re-cut and orphaning
    // its old slot.
    const first = pool.allocate(geometry);
    const second = GeometryAtlasPool.from({ rebaseIndices: false }).allocate(geometry);

    expect(second).toBe(first);
    expect(geometry._geometryAtlasAllocation).toBe(first);

    geometry.destroy(true);
  });

  it("registers for pixi's opt-in global teardown", () => {
    // `renderer.destroy(true)` / `{ releaseGlobalResources: true }` calls clear()
    // on everything registered. Ordinary teardown leaves the pool packed.
    expect(GlobalResourceRegistry.isRegistered(GeometryAtlasPool.from({ rebaseIndices: false }))).toBe(true);
    expect(GlobalResourceRegistry.isRegistered(GeometryAtlasPool.from({ rebaseIndices: true }))).toBe(true);
  });
});
