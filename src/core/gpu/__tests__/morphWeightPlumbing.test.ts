import { getApp } from '@test-utils';
import type { Application, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { GEOMETRY_DATA_STRIDE } from '~/core/buffers/GeometryDataStoreBuffer';
import { MESH3D_LANE_MORPH_WEIGHT, MESH3D_STORE_STRIDE } from '~/core/buffers/Mesh3DDataStoreBuffer';
import type { View3DPipeGpu } from '~/core/gpu/View3DPipeGpu';
import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function createMorphedTriangle(targetCount: number): Geometry3D {
  const morphTargets: { positions: Float32Array }[] = [];
  for (let i = 0; i < targetCount; i++) {
    morphTargets.push({ positions: new Float32Array([0, 0, i + 1, 0, 0, i + 1, 0, 0, i + 1]) });
  }

  return new Geometry3D({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    morphTargets,
  });
}

const weightLane = (view3d: View3D, mesh: Mesh3D): number =>
  view3d._sceneBatch.storeBuffer.u32Data[mesh._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_MORPH_WEIGHT];

const getPipe = (app: Application<WebGPURenderer>): View3DPipeGpu => app.renderer.renderPipes.view3d;

describe('morph weight slots, held from joining the scene to leaving it, and their store lane 20', () => {
  it('registers dynamic morphed geometry in the store, outside the atlas, with a no-cull sentinel, and morphs it', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'morph-dynamic-combo',
      appOptions: { preference: 'webgpu', width: 128, height: 128 },
    });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 5);

      const geometry = new Geometry3D({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        morphTargets: [{ positions: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) }],
        dynamic: true,
      });
      const mesh = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xffffff }) });
      mesh.weights![0] = 0.25;
      view3d.root.addChild(mesh);

      app.render();

      expect(geometry.dynamic).toBe(true);
      expect(geometry._geometryAtlasAllocation).toBeFalsy();
      expect(geometry._geometryDataIndex).toBeGreaterThanOrEqual(0);
      const geomStore = getPipe(app).geometryDataStoreBuffer;
      const rowBase = geometry._geometryDataIndex * GEOMETRY_DATA_STRIDE;
      expect(geomStore.data[rowBase + 3], 'a negative radius keeps it from being frustum-culled').toBeLessThan(0);
      expect(geomStore.u32Data[rowBase + 6], 'outside an atlas its vertex ids are already local').toBe(0);

      const morph = mesh._morph!;
      expect(morph._slot).toBeGreaterThanOrEqual(0);
      expect(getPipe(app)._morphStoreBuffer.data[morph._weightIndex]).toBeCloseTo(0.25);
    } finally {
      app.destroy();
    }
  });

  it('leaves survivors untouched on removal and recycles the freed slot', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'morph-slot-recycle',
      appOptions: { preference: 'webgpu', width: 128, height: 128 },
    });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 5);

      const material = new Material3D({ baseColor: 0xffffff });
      const meshA = new Mesh3D({ geometry: createMorphedTriangle(4), material });
      const meshB = new Mesh3D({ geometry: createMorphedTriangle(3), material });
      const meshC = new Mesh3D({ geometry: createMorphedTriangle(2), material });
      view3d.root.addChild(meshA);
      view3d.root.addChild(meshB);
      view3d.root.addChild(meshC);

      app.render();
      const indexA = meshA._morph!._weightIndex;
      const indexB = meshB._morph!._weightIndex;
      const indexC = meshC._morph!._weightIndex;

      view3d.root.removeChild(meshA);
      expect(meshA._morph!._slot, 'the slot goes with scene membership').toBe(-1);

      app.render();
      expect(meshB._morph!._weightIndex).toBe(indexB);
      expect(meshC._morph!._weightIndex).toBe(indexC);
      expect(weightLane(view3d, meshB)).toBe(indexB);
      expect(weightLane(view3d, meshC)).toBe(indexC);

      const meshD = new Mesh3D({ geometry: createMorphedTriangle(4), material });
      view3d.root.addChild(meshD);
      app.render();
      expect(meshD._morph!._weightIndex, "D has as many targets as A, so it reuses A's freed slot").toBe(indexA);
      expect(weightLane(view3d, meshD)).toBe(indexA);
    } finally {
      app.destroy();
    }
  });

  it('re-emits rows when delta-arena growth shifts the weights base', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'morph-slot-arena-growth',
      appOptions: { preference: 'webgpu', width: 128, height: 128 },
    });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 5);

      const material = new Material3D({ baseColor: 0xffffff });
      const meshA = new Mesh3D({ geometry: createMorphedTriangle(2), material });
      view3d.root.addChild(meshA);

      app.render();
      const indexA = meshA._morph!._weightIndex;
      const slotA = meshA._morph!._slot;

      const big = new Mesh3D({ geometry: createMorphedTriangle(340), material });
      view3d.root.addChild(big);
      app.render();

      const store = getPipe(app)._morphStoreBuffer as unknown as { _deltaCapacity: number };
      expect(store._deltaCapacity).toBeGreaterThan(4096);
      expect(meshA._morph!._slot, 'the slot is relative to the weights base').toBe(slotA);
      expect(meshA._morph!._weightIndex, 'the arena doubled, moving the weights base').not.toBe(indexA);
      expect(weightLane(view3d, meshA), 'the store row followed').toBe(meshA._morph!._weightIndex);
      expect(weightLane(view3d, big)).toBe(big._morph!._weightIndex);
    } finally {
      app.destroy();
    }
  });
});
