import { getApp } from '@test-utils';
import { uid } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { RenderPassBit } from '../../render-passes/RenderPass';

function burnGeometryUids(from: number, gap: number): void {
  for (let i = 0; i < gap - 1; i++) uid('geometry');
}

describe('batch key with colliding geometry uids', () => {
  it('emits one draw per geometry when two uids collide in 12 bits', async () => {
    const app = await getApp<Renderer>({
      id: 'batch-key-collision',
      appOptions: { preference: 'webgpu', width: 256, height: 256 },
    });

    try {
      const view3d = new View3D({ width: 256, height: 256 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 8);

      const cube = new CubeGeometry({ width: 1, height: 1, depth: 1 });
      burnGeometryUids(cube.uid, 0x1000);
      const sphere = new SphereGeometry({ radius: 0.6 });

      expect(sphere.uid - cube.uid).toBe(0x1000);
      expect(sphere.uid & 0xfff).toBe(cube.uid & 0xfff);

      const material = new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 0.5 });
      const meshA = new Mesh3D({ geometry: cube, material, castShadow: false });
      const meshB = new Mesh3D({ geometry: sphere, material, castShadow: false });
      meshA.position.set(-1, 0, 0);
      meshB.position.set(1, 0, 0);
      view3d.root.addChild(meshA, meshB);

      app.render();

      const allocA = cube._geometryAtlasAllocation!;
      const allocB = sphere._geometryAtlasAllocation!;

      expect(allocA.atlas, 'one atlas, so one pipeline, leaves only the batch key to separate them').toBe(allocB.atlas);
      expect(meshA._passCache[RenderPassBit.OPAQUE].batchKey).not.toBe(meshB._passCache[RenderPassBit.OPAQUE].batchKey);

      const pd = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
      expect(pd.commandList.count).toBe(2);

      const calls = pd.drawData.drawCalls;
      const drawn = [
        { indexCount: calls[0], instances: calls[1], firstIndex: calls[2] },
        { indexCount: calls[5], instances: calls[6], firstIndex: calls[7] },
      ].sort((a, b) => a.firstIndex - b.firstIndex);
      const expected = [
        { indexCount: allocA.indexCount, instances: 1, firstIndex: allocA.firstIndex },
        { indexCount: allocB.indexCount, instances: 1, firstIndex: allocB.firstIndex },
      ].sort((a, b) => a.firstIndex - b.firstIndex);

      expect(drawn, 'one instance per draw, each over its own index range').toEqual(expected);
    } finally {
      app.destroy();
    }
  });
});
