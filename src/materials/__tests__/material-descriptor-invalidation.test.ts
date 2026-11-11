import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Mesh3D } from '~/scene/Mesh3D';

const makeMesh = (material: Material3D) =>
  new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material });

describe('material descriptor version', () => {
  it('does not bump on a no-op assignment', () => {
    const material = new Material3D({ baseColor: 0xffffff });

    material.alphaMode = 'blend';
    const settled = material._descriptorDirtyId;

    material.alphaMode = 'blend';

    expect(material._descriptorDirtyId).toBe(settled);
  });

  it('bumps when a custom pass is enabled at runtime, and not when it is enabled again', () => {
    const material = new Material3D({ baseColor: 0xffffff });
    const before = material._descriptorDirtyId;

    material.enablePass('outline-invalidation-test');

    expect(material._descriptorDirtyId).toBeGreaterThan(before);

    const settled = material._descriptorDirtyId;

    material.enablePass('outline-invalidation-test');
    expect(material._descriptorDirtyId).toBe(settled);
  });
});

describe('castShadow marks the mesh dirty, so its shadow pass cache gets built', () => {
  it('stays free when the flip is a no-op', () => {
    const mesh = makeMesh(new Material3D({ baseColor: 0xffffff }));

    mesh.castShadow = true;
    mesh._batchDirty = false;

    mesh.castShadow = true;

    expect(mesh._batchDirty).toBe(false);
  });
});

describe('BatchedMesh3D.invalidate', () => {
  it('flushes a settled slot whose material mutated, which the batch does not notice on its own', () => {
    const batched = new BatchedMesh3D({ size: 4 });
    const material = new Material3D({ baseColor: 0xffffff });
    const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });

    batched.setGeometryAt(0, geometry);
    batched.setMaterialAt(0, material);

    const slot = batched.batch.items[0];

    slot._batchDirty = false;
    batched.batch._dirtyCount = 0;

    material.alphaMode = 'blend';
    expect(slot._batchDirty).toBe(false);

    batched.invalidate(0);

    expect(slot._batchDirty).toBe(true);
    expect(batched.batch._dirtyCount).toBe(1);

    batched.destroy();
  });
});
