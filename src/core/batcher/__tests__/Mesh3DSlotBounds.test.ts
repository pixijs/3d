import { describe, expect, it } from 'vitest';

import { Mesh3DBatch } from '~/core/batcher/Mesh3DBatch';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { Matrix4 } from '~/math/matrix/Matrix4';

const localRadius = (geometry: Geometry3D) => {
  const { min, max } = geometry.bounds3D;
  return 0.5 * Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z);
};

const cube = (dynamic = false) => new CubeGeometry({ width: 2, height: 2, depth: 2, dynamic });

describe('Mesh3DSlot.boundingSphere', () => {
  it('scales the radius by the instance matrix', () => {
    const batch = new Mesh3DBatch({ size: 1 });
    const geometry = cube();
    batch.setGeometryAt(0, geometry);
    batch.setMatrixAt(0, new Matrix4().makeScale(2, 3, 1));
    expect(batch.items[0].boundingSphere.radius).toBeCloseTo(localRadius(geometry) * 3);
  });

  const cubesAt = (...xs: number[]) => {
    const batch = new Mesh3DBatch({ size: xs.length });
    const matrix = new Matrix4();
    for (let i = 0; i < xs.length; i++) {
      batch.setGeometryAt(i, cube());
      batch.setMatrixAt(i, matrix.makeTranslation(xs[i], 0, 0));
    }
    return batch;
  };

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

  it('reports an empty sphere for dynamic geometry', () => {
    const batch = new Mesh3DBatch({ size: 1 });
    batch.setGeometryAt(0, cube(true));
    batch.setMatrixAt(0, new Matrix4());
    expect(batch.items[0].boundingSphere.isEmpty()).toBe(true);
  });
});
