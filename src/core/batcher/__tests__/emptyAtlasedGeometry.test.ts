import { expectCleanRender, getApp } from '@test-utils';
import type { Renderer, WebGLRenderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { cpuSubmission } from '~/core/cull';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

async function scene(id: string, preference: 'webgpu' | 'webgl') {
  const app = await getApp<Renderer>({ id, appOptions: { preference, width: 64, height: 64 } });
  const view3d = new View3D({ width: 64, height: 64 });
  app.stage.addChild(view3d);
  view3d.camera.position.set(0, 0, 5);

  const triangle = new Geometry3D({
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  });
  const empty = new Geometry3D({
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
  });
  const material = new Material3D({ baseColor: 0xffffff });
  view3d.root.addChild(new Mesh3D({ geometry: triangle, material }));
  app.render();
  view3d.root.addChild(new Mesh3D({ geometry: empty, material }));
  app.render();

  return { app, view3d, triangle, empty };
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`an atlased geometry with no indices (${preference})`, () => {
    it('draws zero indices, never the whole atlas from its offset', async () => {
      const { app, view3d, triangle, empty } = await scene(`empty-atlased-${preference}`, preference);
      try {
        const alloc = empty._geometryAtlasAllocation;
        expect(alloc, 'the empty geometry is atlased like any static one').not.toBeNull();
        expect(alloc!.indexCount).toBe(0);
        expect(alloc!.firstIndex, 'it sits after the triangle in the same atlas').toBe(
          triangle.indexBuffer.data.length,
        );
        const atlasIndices = alloc!.atlas.geometry.indexBuffer.data.length;

        let commands = 0;
        let emptyCounts = 0;
        const drawLists = view3d._sceneBatch.drawLists;
        for (const bit in drawLists) {
          const { commandList, drawData } = drawLists[bit];
          const calls = drawData.drawCalls;
          for (let k = 0; k < commandList.count; k++) {
            const count = calls[k * 5];
            const start = calls[k * 5 + 2];
            commands++;
            expect(start + count, `command ${k} of pass ${bit} stays in the atlas`).toBeLessThanOrEqual(atlasIndices);
            if (start === alloc!.firstIndex && count === 0) emptyCounts++;
          }
        }
        expect(commands).toBeGreaterThan(0);
        expect(emptyCounts, 'the empty mesh records a zero count').toBeGreaterThan(0);
      } finally {
        app.destroy();
      }
    });
  });
}

describe('an atlased geometry with no indices (webgl draws)', () => {
  it('has no draw refused by the GPU', async () => {
    const { app } = await scene('empty-atlased-gl-error', 'webgl');
    try {
      const gl = (app.renderer as WebGLRenderer).gl;
      expect(gl.getError()).toBe(gl.NO_ERROR);
    } finally {
      app.destroy();
    }
  });
});

describe('an atlased geometry with no indices (webgpu direct draws)', () => {
  afterEach(() => {
    delete cpuSubmission.forward;
  });

  it('skips the empty command, which pixi would draw as the whole atlas from its offset', async () => {
    cpuSubmission.forward = Infinity;
    const { app, view3d } = await scene('empty-atlased-direct', 'webgpu');
    try {
      view3d.cull = 'off';
      await expectCleanRender(app);

      const result = (view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass).cullResults.get(view3d._sceneBatch);
      expect(result?.direct, 'the pass draws the batch direct').toBe(true);
      const args = result!.indirectDrawData.drawCalls;
      let emptyWithInstances = 0;
      for (let k = 0; k < view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].commandList.count; k++) {
        if (args[k * 5] === 0 && args[k * 5 + 1] > 0) emptyWithInstances++;
      }
      expect(emptyWithInstances, 'the empty mesh survives into a command with no indices').toBe(1);
    } finally {
      app.destroy();
    }
  });
});
