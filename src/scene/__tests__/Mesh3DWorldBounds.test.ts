import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Container3D } from '~/scene/Container3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { updateTransformAndChildren3D } from '~/scene/utils/updateView3DTransforms';

// A blank Container3D is shape-equivalent to the production TEMP_PARENT_3D sentinel
// (identity worldTransform, worldVisible=1), so it stands in as the parent.
const tempParent = new Container3D();
let tick = 0;
// Drives the real transform pass: recomputes worldTransform and bumps _worldTransformId,
// exactly as updateView3DTransforms does each frame.
const runTransformPass = (node: Container3D) => updateTransformAndChildren3D(node, tempParent, ++tick, false, false);

const makeMesh = (size: number, dynamic = false) =>
  new Mesh3D({
    geometry: new CubeGeometry({ width: size, height: size, depth: size, dynamic }),
    material: new Material3D({ baseColor: 0xffffff }),
  });

// Local bounding sphere radius the cull derives from an AABB: half the diagonal.
const localRadius = (mesh: Mesh3D) => {
  const { min, max } = mesh.geometry.bounds3D;
  return 0.5 * Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z);
};

describe('Mesh3D.boundingSphere', () => {
  it('returns the geometry local sphere under an identity transform', () => {
    const mesh = makeMesh(2);
    runTransformPass(mesh);

    const s = mesh.boundingSphere;
    expect(s.center.x).toBeCloseTo(0);
    expect(s.center.y).toBeCloseTo(0);
    expect(s.center.z).toBeCloseTo(0);
    expect(s.radius).toBeCloseTo(localRadius(mesh));
  });

  it('follows the world translation after the transform pass', () => {
    const mesh = makeMesh(2);
    mesh.position.set(5, -3, 2);
    runTransformPass(mesh);

    const s = mesh.boundingSphere;
    expect(s.center.x).toBeCloseTo(5);
    expect(s.center.y).toBeCloseTo(-3);
    expect(s.center.z).toBeCloseTo(2);
    expect(s.radius).toBeCloseTo(localRadius(mesh)); // translation doesn't scale the radius
  });

  it('scales the radius by the max axis scale', () => {
    const mesh = makeMesh(2);
    runTransformPass(mesh);
    const base = mesh.boundingSphere.radius;

    mesh.scale.set(2, 3, 1); // longest axis = 3
    runTransformPass(mesh);
    expect(mesh.boundingSphere.radius).toBeCloseTo(base * 3);
  });

  it('is cached against the transform version — a position change is invisible until the pass runs', () => {
    const mesh = makeMesh(2);
    runTransformPass(mesh);
    expect(mesh.boundingSphere.center.x).toBeCloseTo(0);

    // Sets the dirty flags but does NOT bump _worldTransformId (only the transform pass does).
    mesh.position.set(10, 0, 0);
    expect(mesh.boundingSphere.center.x).toBeCloseTo(0); // still the cached value

    runTransformPass(mesh);
    expect(mesh.boundingSphere.center.x).toBeCloseTo(10); // recomputed against the new transform
  });

  it('recomputes when the geometry is swapped, even without a transform change', () => {
    const mesh = makeMesh(2);
    runTransformPass(mesh);
    const small = mesh.boundingSphere.radius;

    mesh.geometry = new CubeGeometry({ width: 10, height: 10, depth: 10 });
    // No transform pass — the geometry reference changed, which alone invalidates the cache.
    expect(mesh.boundingSphere.radius).toBeGreaterThan(small);
  });

  it('reports an empty sphere for dynamic geometry (no registered bounds)', () => {
    const mesh = makeMesh(2, true);
    runTransformPass(mesh);

    expect(mesh.boundingSphere.isEmpty()).toBe(true);
    expect(mesh.boundingSphere.radius).toBeLessThan(0);
  });
});
