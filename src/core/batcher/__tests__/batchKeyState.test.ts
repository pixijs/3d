import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { RenderPassBit } from '../../render-passes/RenderPass';

const build = (material: Material3D, geometry: CubeGeometry, x: number): Mesh3D => {
  const mesh = new Mesh3D({ geometry, material, castShadow: false });
  mesh.position.set(x, 0, 0);

  return mesh;
};

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`batch key with a state-only difference (${preference})`, () => {
    it('breaks the run when two materials differ only in render state', async () => {
      const app = await getApp<Renderer>({
        id: `batch-key-state-${preference}`,
        appOptions: { preference, width: 256, height: 256 },
      });

      try {
        const view3d = new View3D({ width: 256, height: 256 });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 8);

        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const matA = new Material3D({ baseColor: 0xff0000 });
        const matB = new Material3D({ baseColor: 0x00ff00 });
        matB.state.depthTest = false;

        const meshA = build(matA, geometry, -1);
        const meshB = build(matB, geometry, 1);
        view3d.root.addChild(meshA, meshB);

        app.render();

        const bit = RenderPassBit.OPAQUE;
        const cacheA = meshA._passCache[bit];
        const cacheB = meshB._passCache[bit];

        expect(cacheA.shader).toBe(cacheB.shader);
        expect(meshA.geometry).toBe(meshB.geometry);
        expect(matA.state.data).not.toBe(matB.state.data);

        expect(cacheA.batchKey).not.toBe(cacheB.batchKey);

        const pd = view3d._sceneBatch.drawLists[bit];
        expect(pd.commandList.count).toBe(2);

        const states = [];
        for (let i = 0; i < pd.commandList.count; i++) states.push(pd.commandList.commands[i].state);
        expect(states).toContain(matA.state);
        expect(states).toContain(matB.state);
      } finally {
        app.destroy();
      }
    });

    it('still fuses meshes that agree on everything', async () => {
      const app = await getApp<Renderer>({
        id: `batch-key-state-fuse-${preference}`,
        appOptions: { preference, width: 256, height: 256 },
      });

      try {
        const view3d = new View3D({ width: 256, height: 256 });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 8);

        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const meshA = build(new Material3D({ baseColor: 0xff0000 }), geometry, -1);
        const meshB = build(new Material3D({ baseColor: 0x00ff00 }), geometry, 1);
        view3d.root.addChild(meshA, meshB);

        app.render();

        const bit = RenderPassBit.OPAQUE;
        expect(
          meshA.material.state,
          'each material has its own equal State, which a key comparing state by identity would split',
        ).not.toBe(meshB.material.state);
        expect(meshA._passCache[bit].batchKey).toBe(meshB._passCache[bit].batchKey);

        const pd = view3d._sceneBatch.drawLists[bit];
        expect(pd.commandList.count).toBe(1);
        expect(pd.drawData.drawCalls[1]).toBe(2);
      } finally {
        app.destroy();
      }
    });
  });
}
