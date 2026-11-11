import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateTransformAndChildren3D } from '~/scene/utils/updateView3DTransforms';

const tempParent = new Container3D();
let tick = 0;
const runTransformPass = (node: Container3D) => updateTransformAndChildren3D(node, tempParent, ++tick, false, false);

const makeMesh = (size: number, dynamic = false) =>
  new Mesh3D({
    geometry: new CubeGeometry({ width: size, height: size, depth: size, dynamic }),
    material: new Material3D({ baseColor: 0xffffff }),
  });

const localRadius = (mesh: Mesh3D) => {
  const { min, max } = mesh.geometry.bounds3D;
  return 0.5 * Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z);
};

describe('Mesh3D.boundingSphere', () => {
  it('follows the world translation after the transform pass, keeping the local radius', () => {
    const mesh = makeMesh(2);
    mesh.position.set(5, -3, 2);
    runTransformPass(mesh);

    const s = mesh.boundingSphere;
    expect(s.center.x).toBeCloseTo(5);
    expect(s.center.y).toBeCloseTo(-3);
    expect(s.center.z).toBeCloseTo(2);
    expect(s.radius).toBeCloseTo(localRadius(mesh));
  });

  it('scales the radius by the max axis scale', () => {
    const mesh = makeMesh(2);
    runTransformPass(mesh);
    const base = mesh.boundingSphere.radius;

    mesh.scale.set(2, 3, 1);
    runTransformPass(mesh);
    expect(mesh.boundingSphere.radius).toBeCloseTo(base * 3);
  });

  it('is cached against the transform version — a position change is invisible until the pass runs', () => {
    const mesh = makeMesh(2);
    runTransformPass(mesh);
    expect(mesh.boundingSphere.center.x).toBeCloseTo(0);

    mesh.position.set(10, 0, 0);
    expect(mesh.boundingSphere.center.x).toBeCloseTo(0);

    runTransformPass(mesh);
    expect(mesh.boundingSphere.center.x).toBeCloseTo(10);
  });

  it('recomputes when the geometry is swapped, even without a transform change', () => {
    const mesh = makeMesh(2);
    runTransformPass(mesh);
    const small = mesh.boundingSphere.radius;

    mesh.geometry = new CubeGeometry({ width: 10, height: 10, depth: 10 });
    expect(mesh.boundingSphere.radius).toBeGreaterThan(small);
  });

  it('reports an empty sphere for dynamic geometry (no registered bounds)', () => {
    const mesh = makeMesh(2, true);
    runTransformPass(mesh);

    expect(mesh.boundingSphere.isEmpty()).toBe(true);
    expect(mesh.boundingSphere.radius).toBeLessThan(0);
  });
});
