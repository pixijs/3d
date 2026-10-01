import { getApp } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

describe('draw-args buffer resolves dynamic (non-atlased) geometry counts', () => {
  it('writes the concrete index count for a dynamic-geometry mesh', async () => {
    const app = await getApp({ id: 'dyn-args', appOptions: { preference: 'webgpu', width: 128, height: 128 } });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);

      const geom = new CubeGeometry({ width: 2, height: 2, depth: 2, dynamic: true });
      expect(geom.dynamic).toBe(true);
      const mesh = new Mesh3D({ geometry: geom, material: new Material3D({ baseColor: 0xffffff }) });
      view3d.root.addChild(mesh);
      view3d.camera.position.set(0, 0, 5);

      app.render();

      expect(geom._geometryAtlasAllocation, 'dynamic geometry stays out of the atlas').toBeNull();

      let drawCalls: Uint32Array | undefined;
      const drawLists = view3d._sceneBatch.drawLists;
      for (const bit in drawLists) {
        const pd = drawLists[bit];
        if (pd.commandList.count > 0) drawCalls = pd.drawData.drawCalls;
      }

      expect(drawCalls).toBeDefined();
      expect(drawCalls![0]).toBe(geom.indexBuffer!.data.length);
      expect(drawCalls![1]).toBe(1);
    } finally {
      app.destroy();
    }
  });

  it('renders a non-indexed dynamic geometry through the synthesized index buffer', async () => {
    const app = await getApp({ id: 'noindex-args', appOptions: { preference: 'webgpu', width: 128, height: 128 } });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);

      const geom = new Geometry3D({
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        dynamic: true,
      });
      const mesh = new Mesh3D({ geometry: geom, material: new Material3D({ baseColor: 0xffffff }) });
      view3d.root.addChild(mesh);
      view3d.camera.position.set(0, 0, 5);

      app.render();

      expect(geom._geometryAtlasAllocation).toBeNull();

      let drawCalls: Uint32Array | undefined;
      const drawLists = view3d._sceneBatch.drawLists;
      for (const bit in drawLists) {
        const pd = drawLists[bit];
        if (pd.commandList.count > 0) drawCalls = pd.drawData.drawCalls;
      }

      expect(drawCalls).toBeDefined();
      expect(drawCalls![0]).toBe(geom.vertexCount);
      expect(drawCalls![1]).toBe(1);
    } finally {
      app.destroy();
    }
  });
});
