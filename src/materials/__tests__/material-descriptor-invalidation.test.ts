import { getApp, isCI } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

const makeMesh = (material: Material3D) =>
  new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material });

describe('material descriptor version', () => {
  it('bumps when alphaMode changes render pass routing', () => {
    const material = new Material3D({ baseColor: 0xffffff });
    const before = material._descriptorDirtyId;

    material.alphaMode = 'blend';

    expect(material._descriptorDirtyId).toBeGreaterThan(before);
    expect(material._passBit).toBe(RenderPassBit.TRANSPARENT);
  });

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

  it('survives the sort key being re-memoised', () => {
    const material = new Material3D({ baseColor: 0xffffff });

    material.alphaMode = 'blend';
    const afterInvalidate = material._descriptorDirtyId;

    expect(material['_textureCacheKey']).toBe(-1);

    void material.textureCacheKey;

    expect(material['_textureCacheKey']).not.toBe(-1);
    expect(material._descriptorDirtyId).toBe(afterInvalidate);
  });
});

describe('castShadow marks the mesh dirty, so its shadow pass cache gets built', () => {
  it('flags a rebuild when the shadow bit actually changes', () => {
    const mesh = makeMesh(new Material3D({ baseColor: 0xffffff }));

    mesh.castShadow = false;
    mesh._batchDirty = false;

    mesh.castShadow = true;

    expect(mesh.renderPassMask & RenderPassBit.SHADOW).toBeTruthy();
    expect(mesh._batchDirty).toBe(true);
  });

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

    const slot = batched.items[0];

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

for (const preference of ['webgpu', 'webgl'] as const) {
  describe.skipIf(isCI)(`shared material pass migration (${preference})`, () => {
    it('rebuilds every mesh sharing the material, not just the first, when it changes pass', async () => {
      const app = await getApp<Renderer>({
        id: `descriptor-invalidation-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });

        app.stage.addChild(view3d);

        const material = new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5 });
        const meshes = [makeMesh(material), makeMesh(material), makeMesh(material)];

        meshes.forEach((mesh, i) => {
          mesh.position.set(i * 2 - 2, 0, 0);
          view3d.root.addChild(mesh);
        });

        view3d.camera.position.set(0, 3, 6);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

        app.render();

        for (const mesh of meshes) {
          expect(mesh._passCache[RenderPassBit.OPAQUE]).toBeDefined();
        }

        material.alphaMode = 'blend';

        expect(() => app.render()).not.toThrow();

        for (const mesh of meshes) {
          expect(mesh._passCache[RenderPassBit.TRANSPARENT]).toBeDefined();
          expect(mesh._passCache[RenderPassBit.TRANSPARENT].shader).toBeDefined();
        }

        material.alphaMode = 'opaque';
        expect(() => app.render()).not.toThrow();
      } finally {
        app.destroy();
      }
    });
  });
}
