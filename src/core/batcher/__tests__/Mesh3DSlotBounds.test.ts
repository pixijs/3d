import { describe, expect, it } from 'vitest';

import { Mesh3DBatch } from '~/core/batcher/Mesh3DBatch';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { Matrix4 } from '~/math/matrix/Matrix4';

/** The local bounding sphere radius the cull derives from a geometry's box: half its diagonal */
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
    expect(s.radius).toBeCloseTo(localRadius(geometry));
  });

  it('scales the radius by the instance matrix', () => {
    const batch = new Mesh3DBatch({ size: 1 });
    const geometry = cube();
    batch.setGeometryAt(0, geometry);
    batch.setMatrixAt(0, new Matrix4().makeScale(2, 3, 1));
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

  /** A batch of `xs.length` cubes, slot `i` translated to `xs[i]` on X */
  const cubesAt = (...xs: number[]) => {
    const batch = new Mesh3DBatch({ size: xs.length });
    const matrix = new Matrix4();
    for (let i = 0; i < xs.length; i++) {
      batch.setGeometryAt(i, cube());
      batch.setMatrixAt(i, matrix.makeTranslation(xs[i], 0, 0));
    }
    return batch;
  };

  /** Writes slot `i`'s X translation in place, as a user of `matrices.data` would */
  const moveInPlace = (batch: Mesh3DBatch, i: number, x: number) => {
    const { data, stride, offset } = batch.matrices;
    data[offset + i * stride + 12] = x;
  };

  it('releases retained slots when their batch is destroyed', () => {
    const batch = cubesAt(1, 2);
    const slots = [...batch.items];
    for (const slot of slots) void slot.boundingSphere;

    batch.destroy();
    batch.destroy();

    for (const slot of slots) {
      expect((slot as unknown as { _batch: unknown })._batch).toBeNull();
    }
  });

  it('keeps matrix data and bounds updates usable after unload', () => {
    const batch = cubesAt(1, 2);
    const matrices = batch.matrices;
    const data = matrices.data;
    expect(batch.items[0].boundingSphere.center.x).toBeCloseTo(1);

    batch.unload();
    batch.unload();

    expect(batch.matrices).toBe(matrices);
    expect(matrices.data).toBe(data);
    moveInPlace(batch, 0, 9);
    matrices.update();
    expect(batch.items[0].boundingSphere.center.x).toBeCloseTo(9);
    expect(batch.items[1].boundingSphere.center.x).toBeCloseTo(2);
    batch.destroy();
  });

  it('rebuilds every slot after an in-place write and a whole-batch update', () => {
    const batch = cubesAt(1, 2, 3);
    for (let i = 0; i < 3; i++) expect(batch.items[i].boundingSphere.center.x).toBeCloseTo(i + 1);

    for (let i = 0; i < 3; i++) moveInPlace(batch, i, i + 7);
    batch.matrices.update();
    for (let i = 0; i < 3; i++) expect(batch.items[i].boundingSphere.center.x).toBeCloseTo(i + 7);
  });

  it('rebuilds only the named slots after a partial update', () => {
    const batch = cubesAt(1, 2, 3);
    for (let i = 0; i < 3; i++) expect(batch.items[i].boundingSphere.center.x).toBeCloseTo(i + 1);

    for (let i = 0; i < 3; i++) moveInPlace(batch, i, 50);
    batch.matrices.update(1, 1);

    expect(batch.items[1].boundingSphere.center.x).toBeCloseTo(50);
    expect(batch.items[0].boundingSphere.center.x, 'a slot outside the range keeps its sphere').toBeCloseTo(1);
    expect(batch.items[2].boundingSphere.center.x).toBeCloseTo(3);
  });

  it('a slot write after a whole-batch update still rebuilds that slot', () => {
    const batch = cubesAt(1, 2);
    batch.matrices.update();
    expect(batch.items[0].boundingSphere.center.x).toBeCloseTo(1);

    batch.setMatrixAt(0, new Matrix4().makeTranslation(4, 0, 0));
    expect(batch.items[0].boundingSphere.center.x).toBeCloseTo(4);
    expect(batch.items[1].boundingSphere.center.x).toBeCloseTo(2);
  });

  it('is batch-local, so moving the container costs the cull nothing', () => {
    const batch = new Mesh3DBatch({ size: 1 });
    batch.setGeometryAt(0, cube());
    batch.setMatrixAt(0, new Matrix4().makeTranslation(1, 2, 3));
    const before = batch.items[0].boundingSphere.clone();

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
