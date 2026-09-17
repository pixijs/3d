import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { View3D } from '~/scene/View3D';

import type { ForwardRenderPass } from '../../render-passes/ForwardRenderPass';
import { RenderPassBit } from '../../render-passes/RenderPass';

function createBatch(geometry: CubeGeometry, material: Material3D): BatchedMesh3D {
  const batch = new BatchedMesh3D({ size: 1 });
  batch.setGeometryAt(0, geometry);
  batch.setMaterialAt(0, material);
  batch.setMatrixAt(0, new Matrix4());
  batch.setItemActive(0, RenderPassBit.OPAQUE);
  return batch;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`batch/pass dirty isolation (${preference})`, () => {
    it('rebuilds only the batch whose draw data changed', async () => {
      const app = await getApp<Renderer>({
        id: `batch-dirty-isolation-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const materialA = new Material3D({ baseColor: 0xff0000 });
        const materialB = new Material3D({ baseColor: 0x00ff00 });
        const batchA = createBatch(geometry, materialA);
        const batchB = createBatch(geometry, materialB);

        view3d.root.addChild(batchA, batchB);
        app.stage.addChild(view3d);

        // First render builds everything; the second proves the caches are settled.
        app.render();
        app.render();

        const passA = batchA.batch.drawLists[RenderPassBit.OPAQUE];
        const passB = batchB.batch.drawLists[RenderPassBit.OPAQUE];
        const commandDirtyA = passA.commandList.dirtyId;
        const commandDirtyB = passB.commandList.dirtyId;

        // Both materials are already registered, so this is a purely local slot change.
        batchA.setMaterialAt(0, materialB);
        app.render();

        expect(passA.commandList.dirtyId).toBeGreaterThan(commandDirtyA);
        expect(passB.commandList.dirtyId).toBe(commandDirtyB);
        expect(passA.lastDrawDirtyId).toBe(passA.drawDirtyId);
        expect(passB.lastDrawDirtyId).toBe(passB.drawDirtyId);
      } finally {
        app.destroy();
      }
    });

    it('keeps bundle-only invalidation separate from draw rebuilding', async () => {
      const app = await getApp<Renderer>({
        id: `bundle-dirty-isolation-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        const batch = createBatch(
          new CubeGeometry({ width: 1, height: 1, depth: 1 }),
          new Material3D({ baseColor: 0xffffff }),
        );

        view3d.root.addChild(batch);
        app.stage.addChild(view3d);
        app.render();
        app.render();

        const list = batch.batch.drawLists[RenderPassBit.OPAQUE];
        const commandDirtyId = list.commandList.dirtyId;
        // WebGPU keeps the bundle on the pass's cull result for the batch; WebGL records none.
        const pass = view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass;
        const result = pass.cullResults.get(batch.batch);
        const bundle = result?.bundle ?? null;

        // Bundle-only invalidation, as the render graph issues it when a sampled source swaps.
        list.gpuData.bundleDirtyId++;
        app.render();

        // WebGPU re-records against the moved counter without touching the list; WebGL records
        // nothing and holds no result at all.
        const rerecorded =
          result !== undefined && result.bundle !== bundle && result.lastBundleDirtyId === list.gpuData.bundleDirtyId;
        expect(list.commandList.dirtyId).toBe(commandDirtyId);
        expect(bundle !== null).toBe(preference === 'webgpu');
        expect(rerecorded).toBe(preference === 'webgpu');
      } finally {
        app.destroy();
      }
    });
  });
}
