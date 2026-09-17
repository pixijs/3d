import { getApp } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// The numeric draw args live in the pass's IndirectDrawData (pd.drawData), off the DrawCommand. For static
// (atlased) geometry the counts come from the atlas allocation; for DYNAMIC geometry (no allocation)
// the batcher must resolve the concrete index count exactly as pixi's draw does
// (`size || indexBuffer.data.length`), since a u32 buffer can't carry the "undefined = full geometry"
// sentinel. No visual scene exercises dynamic geometry, so we read the args back directly.

describe('draw-args buffer resolves dynamic (non-atlased) geometry counts', () => {
  it('writes the concrete index count for a dynamic-geometry mesh', async () => {
    const app = await getApp({ id: 'dyn-args', appOptions: { preference: 'webgpu', width: 128, height: 128 } });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);

      // dynamic: true → no atlas allocation, so the batcher takes its concrete-count resolution path.
      const geom = new CubeGeometry({ width: 2, height: 2, depth: 2, dynamic: true });
      expect(geom.dynamic).toBe(true);
      const mesh = new Mesh3D({ geometry: geom, material: new Material3D({ baseColor: 0xffffff }) });
      view3d.root.addChild(mesh);
      view3d.camera.position.set(0, 0, 5);

      app.render();

      // Confirm it actually took the un-atlased path (else we'd be checking the wrong branch).
      expect(geom._geometryAtlasAllocation).toBeNull();

      // Find a pass that drew this mesh and inspect its first command's args.
      let drawCalls: Uint32Array | undefined;
      const drawLists = view3d._sceneBatch.drawLists;
      for (const bit in drawLists) {
        const pd = drawLists[bit];
        if (pd.commandList.count > 0) drawCalls = pd.drawData.drawCalls;
      }

      expect(drawCalls).toBeDefined();
      // indexCount resolved to the geometry's own index buffer (not 0/undefined); one instance.
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

      // dynamic + no indices → the un-atlased draw path that threw at
      // Mesh3DBatcher `indexBuffer!.data.length` before the synthesis landed.
      const geom = new Geometry3D({
        positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        dynamic: true,
      });
      const mesh = new Mesh3D({ geometry: geom, material: new Material3D({ baseColor: 0xffffff }) });
      view3d.root.addChild(mesh);
      view3d.camera.position.set(0, 0, 5);

      app.render();

      // Stayed un-atlased (dynamic), and the draw resolved against the synthesized buffer.
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
