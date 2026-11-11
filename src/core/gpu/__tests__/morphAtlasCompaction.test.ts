import { getApp } from '@test-utils';
import type { Application, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { GEOMETRY_DATA_STRIDE } from '~/core/buffers/GeometryDataStoreBuffer';
import type { View3DPipeGpu } from '~/core/gpu/View3DPipeGpu';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const VERTS = 400;

const BASE_VERTEX_LANE = 6;

function makeGeometry(morphed: boolean): Geometry3D {
  const positions = new Float32Array(VERTS * 3);
  const normals = new Float32Array(VERTS * 3);
  const indices = new Uint32Array(VERTS);

  for (let i = 0; i < VERTS; i++) {
    positions[i * 3] = i * 0.01;
    normals[i * 3 + 2] = 1;
    indices[i] = i;
  }

  return new Geometry3D({
    positions,
    normals,
    indices,
    morphTargets: morphed ? [{ positions: new Float32Array(VERTS * 3).fill(1) }] : undefined,
  });
}

const getPipe = (app: Application<WebGPURenderer>): View3DPipeGpu => app.renderer.renderPipes.view3d;

describe('morph geometry rows across an atlas compaction, which moves baseVertex without dirtying any mesh', () => {
  it('re-stamps the cached baseVertex when compaction slides the allocation', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'morph-atlas-compaction',
      appOptions: { preference: 'webgpu', width: 128, height: 128 },
    });

    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 5);

      const pipe = getPipe(app);

      const filler = makeGeometry(false);
      pipe.atlasPool.allocate(filler);

      const geometry = makeGeometry(true);
      const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) });
      view3d.root.addChild(mesh);

      app.render();

      const alloc = geometry._geometryAtlasAllocation!;
      expect(alloc).toBeTruthy();
      expect(alloc.atlas).toBe(filler._geometryAtlasAllocation!.atlas);
      expect(alloc.baseVertex).toBe(VERTS);

      const geomStore = pipe.geometryDataStoreBuffer;
      const rowBase = geometry._geometryDataIndex * GEOMETRY_DATA_STRIDE;
      expect(geomStore.u32Data[rowBase + BASE_VERTEX_LANE]).toBe(VERTS);

      filler.destroy();
      const pastHighWatermark = makeGeometry(false);
      pipe.atlasPool.allocate(pastHighWatermark);

      expect(alloc.baseVertex, 'the compaction slid the morphed allocation to the front').toBe(0);
      expect(
        geomStore.u32Data[rowBase + BASE_VERTEX_LANE],
        'nothing dirtied the mesh, so the row keeps the old base',
      ).toBe(VERTS);

      app.render();

      expect(
        geomStore.u32Data[rowBase + BASE_VERTEX_LANE],
        'the view saw the pool move and re-stamped its morphed geometry',
      ).toBe(0);
      expect(geomStore.u32Data[rowBase + BASE_VERTEX_LANE]).toBe(alloc.baseVertex);
    } finally {
      app.destroy();
    }
  });
});
