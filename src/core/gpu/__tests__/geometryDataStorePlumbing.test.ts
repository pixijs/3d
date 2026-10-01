import { getApp } from '@test-utils';
import type { Application, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { GEOMETRY_DATA_STRIDE } from '~/core/buffers/GeometryDataStoreBuffer';
import { MESH3D_LANE_GEOMETRY, MESH3D_STORE_STRIDE } from '~/core/buffers/Mesh3DDataStoreBuffer';
import type { View3DPipeGpu } from '~/core/gpu/View3DPipeGpu';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const getPipe = (app: Application<WebGPURenderer>): View3DPipeGpu => app.renderer.renderPipes.view3d;

describe('geometry-data plumbing the GPU cull reads (bounds sphere + geometry lane), checked in the CPU-staged buffers', () => {
  it('mints an index, stages the sphere from bounds3D, and writes it into the geometry lane', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'geom-data',
      appOptions: { preference: 'webgpu', width: 128, height: 128 },
    });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);

      const geometry = new CubeGeometry({ width: 2, height: 2, depth: 2 });
      const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) });
      view3d.root.addChild(mesh);
      view3d.camera.position.set(0, 0, 5);

      app.render();

      const pipe = getPipe(app);

      expect(geometry._geometryDataIndex).toBeGreaterThanOrEqual(0);
      const storeIndex = mesh._storeIndex;
      expect(view3d._sceneBatch.storeBuffer.u32Data[storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_GEOMETRY]).toBe(
        geometry._geometryDataIndex,
      );

      const b = geometry.bounds3D;
      const cx = (b.min.x + b.max.x) / 2;
      const cy = (b.min.y + b.max.y) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      const r = Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / 2;

      const base = geometry._geometryDataIndex * GEOMETRY_DATA_STRIDE;
      const s = pipe.geometryDataStoreBuffer.data;
      expect(s[base]).toBeCloseTo(cx, 4);
      expect(s[base + 1]).toBeCloseTo(cy, 4);
      expect(s[base + 2]).toBeCloseTo(cz, 4);
      expect(s[base + 3]).toBeCloseTo(r, 4);
    } finally {
      app.destroy();
    }
  });

  it('rewrites the geometry lane with the new index when the mesh geometry is swapped', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'geom-data-swap',
      appOptions: { preference: 'webgpu', width: 128, height: 128 },
    });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);

      const geomA = new CubeGeometry({ width: 2, height: 2, depth: 2 });
      const geomB = new CubeGeometry({ width: 4, height: 4, depth: 4 });
      const mesh = new Mesh3D({ geometry: geomA, material: new Material3D({ baseColor: 0xffffff }) });
      view3d.root.addChild(mesh);
      view3d.camera.position.set(0, 0, 5);

      app.render();
      expect(
        view3d._sceneBatch.storeBuffer.u32Data[mesh._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_GEOMETRY],
      ).toBe(geomA._geometryDataIndex);

      mesh.geometry = geomB;
      app.render();

      expect(geomB._geometryDataIndex).toBeGreaterThanOrEqual(0);
      expect(geomB._geometryDataIndex).not.toBe(geomA._geometryDataIndex);
      expect(
        view3d._sceneBatch.storeBuffer.u32Data[mesh._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_GEOMETRY],
      ).toBe(geomB._geometryDataIndex);
    } finally {
      app.destroy();
    }
  });
});
