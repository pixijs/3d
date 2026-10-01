import { describe, expect, test } from 'vitest';

import { resolveHitVolume } from '~/events/resolveHitVolume';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';

function makeTriangleGeometry(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
}

function makeMesh(): Mesh3D {
  return new Mesh3D({ geometry: makeTriangleGeometry(), material: new Material3D({}) });
}

describe('resolveHitVolume', () => {
  test("'box' on a plain Container3D resolves to a snapshot of its local bounds that later measuring doesn't move", () => {
    const c = new Container3D({ children: [makeMesh()] });
    const resolved = resolveHitVolume(c, 'box');
    const bounds = c.getLocalBounds();

    expect(resolved).toBeInstanceOf(Box);
    expect(resolved).not.toBe(bounds);
    expect(resolved).toEqual(bounds);

    c.children[0].scale.set(4);
    c.getSize();
    c.getLocalBounds();
    expect(resolved).toEqual(bounds);
  });

  test("'box' on a plain Container3D counts hidden children", () => {
    const mesh = makeMesh();
    mesh.visible = false;
    const c = new Container3D({ children: [mesh] });

    const resolved = resolveHitVolume(c, 'box') as Box;

    expect(resolved.min).toMatchObject({ x: -1, y: -1, z: 0 });
    expect(resolved.max).toMatchObject({ x: 1, y: 1, z: 0 });
  });

  test("'geometry' on a plain Container3D warns and resolves to null — no geometry to point at", () => {
    const c = new Container3D();
    expect(resolveHitVolume(c, 'geometry')).toBeNull();
  });

  test('unknown string warns and resolves to null', () => {
    const c = new Container3D();
    expect(resolveHitVolume(c, 'capsule' as never)).toBeNull();
  });
});
