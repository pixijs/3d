import { describe, expect, it } from 'vitest';

import { Mesh3DBatch } from '~/core/batcher/Mesh3DBatch';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { Matrix4 } from '~/math/matrix/Matrix4';

// Local bounding sphere radius the cull derives from an AABB: half the diagonal.
const localRadius = (geometry: Geometry3D) => {
  const { min, max } = geometry.bounds3D;
  return 0.5 * Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z);
};

const cube = (dynamic = false) => new CubeGeometry({ width: 2, height: 2, depth: 2, dynamic });

describe('Mesh3DSlot.boundingSphere', () => {
  it('returns L × geometry sphere (batch-local), following the instance matrix', () => {
    const batch = new Mesh3DBatch({ size: 2 });
    const geometry = cube();
    batch.setGeometryAt(0, geometry);
    batch.setMatrixAt(0, new Matrix4().makeTranslation(5, -3, 2));

    const s = batch.items[0].boundingSphere;
    expect(s.center.x).toBeCloseTo(5);
    expect(s.center.y).toBeCloseTo(-3);
    expect(s.center.z).toBeCloseTo(2);
    expect(s.radius).toBeCloseTo(localRadius(geometry)); // translation doesn't scale
  });

  it('scales the radius by the instance matrix', () => {
    const batch = new Mesh3DBatch({ size: 1 });
    const geometry = cube();
    batch.setGeometryAt(0, geometry);
    batch.setMatrixAt(0, new Matrix4().makeScale(2, 3, 1)); // longest axis = 3
    expect(batch.items[0].boundingSphere.radius).toBeCloseTo(localRadius(geometry) * 3);
  });

  it('rebuilds when the instance matrix changes', () => {
    const batch = new Mesh3DBatch({ size: 1 });
    batch.setGeometryAt(0, cube());
    batch.setMatrixAt(0, new Matrix4().makeTranslation(1, 0, 0));
    expect(batch.items[0].boundingSphere.center.x).toBeCloseTo(1);

    batch.setMatrixAt(0, new Matrix4().makeTranslation(9, 0, 0));
    expect(batch.items[0].boundingSphere.center.x).toBeCloseTo(9);
  });

  it('is batch-local — a container (batch matrix) move leaves it unchanged', () => {
    const batch = new Mesh3DBatch({ size: 1 });
    batch.setGeometryAt(0, cube());
    batch.setMatrixAt(0, new Matrix4().makeTranslation(1, 2, 3));
    const before = batch.items[0].boundingSphere.clone();

    // Move the batch container (store row 0 = B). The instance's local sphere excludes B, so it
    // must not change — this is the "moving batch is free" property the cull relies on.
    batch.writeBatchWorldMatrix(new Matrix4().makeTranslation(100, 0, 0));
    const after = batch.items[0].boundingSphere;
    expect(after.center.x).toBeCloseTo(before.center.x);
    expect(after.center.y).toBeCloseTo(before.center.y);
    expect(after.center.z).toBeCloseTo(before.center.z);
    expect(after.radius).toBeCloseTo(before.radius);
  });

  it('rebuilds when the geometry is swapped', () => {
    const batch = new Mesh3DBatch({ size: 1 });
    batch.setGeometryAt(0, cube());
    batch.setMatrixAt(0, new Matrix4());
    const small = batch.items[0].boundingSphere.radius;

    batch.setGeometryAt(0, new CubeGeometry({ width: 10, height: 10, depth: 10 }));
    expect(batch.items[0].boundingSphere.radius).toBeGreaterThan(small);
  });

  it('reports an empty sphere for dynamic geometry', () => {
    const batch = new Mesh3DBatch({ size: 1 });
    batch.setGeometryAt(0, cube(true));
    batch.setMatrixAt(0, new Matrix4());
    expect(batch.items[0].boundingSphere.isEmpty()).toBe(true);
  });
});
