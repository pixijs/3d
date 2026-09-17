import { describe, expect, test } from 'vitest';

import { resolveHitVolume } from '~/events/resolveHitVolume';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { Sphere } from '~/math/shapes/Sphere';
import { Vector3 } from '~/math/vector/Vector3';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';

function makeUnitCubeGeometry(): Geometry3D {
  return new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2]),
  });
}

function makeMesh(): Mesh3D {
  return new Mesh3D({ geometry: makeUnitCubeGeometry(), material: new Material3D({}) });
}

describe('resolveHitVolume', () => {
  test('null → null', () => {
    expect(resolveHitVolume(new Container3D(), null)).toBeNull();
  });

  test("'box' on a Mesh3D resolves to the geometry's live bounds3D", () => {
    const mesh = makeMesh();
    const resolved = resolveHitVolume(mesh, 'box');
    expect(resolved).toBe(mesh.geometry.bounds3D);
  });

  test("'box' on a plain Container3D resolves to a snapshot of its local bounds", () => {
    const c = new Container3D({ children: [makeMesh()] });
    const resolved = resolveHitVolume(c, 'box');
    const bounds = c.getLocalBounds();

    expect(resolved).toBeInstanceOf(Box);
    expect(resolved).not.toBe(bounds);
    expect(resolved).toEqual(bounds);

    // Measuring again must not move the stored volume.
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

  test("'geometry' on a Mesh3D resolves to the mesh's geometry", () => {
    const mesh = makeMesh();
    expect(resolveHitVolume(mesh, 'geometry')).toBe(mesh.geometry);
  });

  test("'geometry' on a plain Container3D warns and resolves to null — no geometry to point at", () => {
    const c = new Container3D();
    expect(resolveHitVolume(c, 'geometry')).toBeNull();
  });

  test('raw Box / Sphere / Geometry3D are stored as-is', () => {
    const c = new Container3D();
    const box = new Box(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const sphere = new Sphere(new Vector3(0, 0, 0), 1);
    const geom = makeUnitCubeGeometry();

    expect(resolveHitVolume(c, box)).toBe(box);
    expect(resolveHitVolume(c, sphere)).toBe(sphere);
    expect(resolveHitVolume(c, geom)).toBe(geom);
  });

  test('unknown string warns and resolves to null', () => {
    const c = new Container3D();
    expect(resolveHitVolume(c, 'capsule' as never)).toBeNull();
  });
});
