import { getApp } from '@test-utils';
import type { Buffer, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Engine-owned buffers are baked into recorded bundles / bind groups / VAOs that never re-fetch
 * them, so the renderer's GC must never reclaim one — including the buffers minted when a store
 * outgrows itself, and the ones it retires in the process.
 */
for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`engine buffer GC exemption (${preference})`, () => {
    it('renders a real scene with every engine-owned buffer exempt', async () => {
      const app = await getApp<Renderer>({
        id: `engine-buffer-exemption-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);

        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0x8899aa }) });
        mesh.position.z = -6;
        view3d.root.addChild(mesh);

        app.render();

        const collectable: string[] = [];
        const check = (label: string, buffer: Buffer): void => {
          if (buffer.autoGarbageCollect) collectable.push(label);
        };

        check('scene store', view3d._sceneBatch.storeBuffer.buffer);
        // WebGPU draws the batch's indirect args from the opaque pass's cull result; WebGL reads the
        // draw list's CPU array and owns no args buffer.
        const opaque = view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass;
        const result = opaque.cullResults.get(view3d._sceneBatch);
        if (result) check('draw calls', result.indirectDrawData.drawCallsBuffer);
        // The mesh was atlased, so the buffers it actually draws from are the atlas's.
        const atlas = geometry._geometryAtlasAllocation!.atlas!;
        atlas.geometry.buffers.forEach((buffer, i) => check(`atlas buffer ${i}`, buffer));

        expect(collectable).toEqual([]);
      } finally {
        app.destroy();
      }
    });

    it('keeps the store exempt across the growth a large batch forces', async () => {
      const app = await getApp<Renderer>({
        id: `engine-buffer-growth-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const view3d = new View3D({ width: 128, height: 128 });
        app.stage.addChild(view3d);

        const geometry = new CubeGeometry({ width: 0.2, height: 0.2, depth: 0.2 });
        const material = new Material3D({ baseColor: 0x8899aa });

        // A batch bigger than the store's initial 100 slots: allocating its block expands the
        // store, retiring the buffer it was born with.
        const batched = new BatchedMesh3D({ size: 400 });
        const storeBuffer = batched.batch.storeBuffer;
        // A non-zero version means the store really reallocated rather than fitting in its initial block.
        expect(storeBuffer.bufferVersion).toBeGreaterThan(0);

        for (let i = 0; i < 400; i++) {
          batched.setGeometryAt(i, geometry);
          batched.setMaterialAt(i, material);
          batched.setMatrixAt(
            i,
            new Matrix4().makeTranslation(((i % 20) - 10) * 0.1, (Math.floor(i / 20) - 10) * 0.1, -6),
          );
          batched.setItemActive(i, RenderPassBit.OPAQUE);
        }
        view3d.root.addChild(batched);

        app.render();

        expect(storeBuffer.buffer.autoGarbageCollect).toBe(false);
      } finally {
        app.destroy();
      }
    });
  });
}
