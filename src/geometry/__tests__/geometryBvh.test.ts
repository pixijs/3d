import { afterEach, describe, expect, it, vi } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import type { Geometry3DOptions } from '~/geometry/Geometry3D';
import { TriangleBvh } from '~/geometry/TriangleBvh';
import { Ray } from '~/math/shapes/Ray';
import { Vector3 } from '~/math/vector/Vector3';

const down = new Ray(new Vector3(0.2, 0.2, 5), new Vector3(0, 0, -1));

const triangle = (options: Partial<Geometry3DOptions> = {}): Geometry3D =>
  new Geometry3D({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
    ...options,
  });

describe('Geometry3D.bvh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bvh is built once and reused', () => {
    const geometry = triangle();
    const tree = geometry.bvh;

    expect(tree).toBeInstanceOf(TriangleBvh);
    expect(geometry.bvh).toBe(tree);
  });

  it('unload keeps the hierarchy and the next read refits it', () => {
    const geometry = triangle();
    const tree = geometry.bvh;
    const refit = vi.spyOn(TriangleBvh.prototype, 'update');

    geometry.unload();

    expect(geometry.bvh).toBe(tree);
    expect(refit).toHaveBeenCalledTimes(1);
  });

  it('a new index array on a non-dynamic geometry is picked up on the next read', () => {
    const geometry = new Geometry3D({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
    });
    const overSecond = new Ray(new Vector3(5.2, 0.2, 5), new Vector3(0, 0, -1));
    expect(geometry.bvh!.raycast(overSecond)).toBe(-1);

    geometry.indexBuffer.data = new Uint16Array([3, 4, 5]);

    expect(geometry.bvh!.raycast(overSecond)).toBe(5);
    expect(geometry.bvh!.raycast(down)).toBe(-1);
  });

  it('unload after an in-place index edit on a non-dynamic geometry refits the hierarchy, and picks follow', () => {
    const positions = new Float32Array(27 * 3);
    for (let i = 0; i < 8; i++) positions.set([i, 0, 0, i + 1, 0, 0, i, 1, 0], i * 9);
    positions.set([20, 0, 0, 21, 0, 0, 20, 1, 0], 72);
    const geometry = new Geometry3D({ positions, indices: new Uint16Array(Array.from({ length: 24 }, (_, i) => i)) });
    const overLast = new Ray(new Vector3(7.2, 0.2, 5), new Vector3(0, 0, -1));
    const overFar = new Ray(new Vector3(20.2, 0.2, 5), new Vector3(0, 0, -1));
    expect(geometry.bvh!.raycast(overLast)).toBe(5);

    geometry.indices.set([24, 25, 26], 21);
    geometry.unload();

    expect(geometry.bvh!.raycast(overFar)).toBe(5);
    expect(geometry.bvh!.raycast(overLast)).toBe(-1);
  });

  it('a position buffer update refits the hierarchy instead of rebuilding it', () => {
    const geometry = triangle();
    const tree = geometry.bvh;
    const positions = geometry.positions;

    for (let i = 2; i < positions.length; i += 3) positions[i] = 2;
    geometry.attributes.aPosition.buffer.update();

    expect(geometry.bvh).toBe(tree);
    expect(geometry.bvh!.raycast(down)).toBeCloseTo(3, 6);
  });

  it('a UV buffer update keeps the hierarchy', () => {
    const geometry = triangle({ uvs: new Float32Array([0, 0, 1, 0, 0, 1]) });
    const tree = geometry.bvh;

    geometry.attributes.aUV.buffer.update();

    expect(geometry.bvh).toBe(tree);
  });

  it('new position data releases the hierarchy at once and the next read builds over it', () => {
    const geometry = triangle();
    const tree = geometry.bvh;

    geometry.positions = new Float32Array([0, 0, 2, 1, 0, 2, 0, 1, 2]);

    expect(geometry['_bvh']).toBeNull();
    expect(geometry.bvh).not.toBe(tree);
    expect(geometry.bvh!.raycast(down)).toBeCloseTo(3, 6);
  });

  it('buildBvh replaces the cached hierarchy and returns the new one', () => {
    const geometry = triangle();
    const tree = geometry.bvh;
    const built = geometry.buildBvh();

    expect(built).toBeInstanceOf(TriangleBvh);
    expect(built).not.toBe(tree);
    expect(geometry.bvh).toBe(built);
  });

  it("buildBvh on a geometry that can't have a hierarchy returns null and clears the cached one", () => {
    const geometry = triangle();
    geometry.buildBvh();

    geometry.topology = 'line-list';

    expect(geometry.buildBvh()).toBeNull();
    expect(geometry['_bvh']).toBeNull();
  });

  it('a dynamic geometry updated many times refits once, on the next read', () => {
    const geometry = triangle({ dynamic: true });
    const tree = geometry.bvh;
    const refit = vi.spyOn(TriangleBvh.prototype, 'update');

    for (let i = 0; i < 100; i++) geometry.attributes.aPosition.buffer.update();
    expect(refit).not.toHaveBeenCalled();
    expect(geometry.bvh).toBe(tree);
    expect(refit).toHaveBeenCalledTimes(1);
  });

  it("a dynamic geometry's index buffer update refits the hierarchy", () => {
    const geometry = triangle({ dynamic: true });
    const tree = geometry.bvh;
    const refit = vi.spyOn(TriangleBvh.prototype, 'update');

    geometry.indexBuffer.update();

    expect(geometry.bvh).toBe(tree);
    expect(refit).toHaveBeenCalledTimes(1);
  });

  it('new index data on a dynamic geometry releases the hierarchy at once', () => {
    const geometry = triangle({ dynamic: true });
    geometry.buildBvh();

    geometry.indexBuffer.data = new Uint16Array([0, 2, 1]);

    expect(geometry['_bvh']).toBeNull();
  });

  it('setting indices to a new array releases the hierarchy at once', () => {
    const geometry = triangle();
    geometry.buildBvh();

    geometry.indices = new Uint16Array([0, 1, 2]);

    expect(geometry['_bvh']).toBeNull();
  });

  it('setting indices to the same array after an in-place edit refits the hierarchy and picks follow', () => {
    const geometry = new Geometry3D({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
    });
    const overSecond = new Ray(new Vector3(5.2, 0.2, 5), new Vector3(0, 0, -1));
    const tree = geometry.bvh;
    const refit = vi.spyOn(TriangleBvh.prototype, 'update');

    const indices = geometry.indices;
    indices.set([3, 4, 5]);
    geometry.indices = indices;

    expect(geometry.bvh).toBe(tree);
    expect(refit).toHaveBeenCalledTimes(1);
    expect(geometry.bvh!.raycast(overSecond)).toBe(5);
    expect(geometry.bvh!.raycast(down)).toBe(-1);
  });

  it("bvh is null for a line list and for positions that aren't a Float32Array", () => {
    expect(triangle({ topology: 'line-list' }).bvh).toBeNull();
    expect(triangle({ interleave: true }).bvh).toBeNull();
  });
});
