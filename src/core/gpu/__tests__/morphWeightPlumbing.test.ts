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

// The shader reads each instance's morph-weight offset from its store row
// (MESH3D_LANE_MORPH_WEIGHT). Slots in the shared morph store are persistent —
// assigned when a mesh joins the scene, freed when it leaves — so these tests
// pin the slot contract: offsets hold still through neighbour add/remove,
// freed slots are recycled bucket-for-bucket, the one legitimate move (delta
// arena growth shifting the weights base) re-emits the affected rows, and
// weight changes land through the walk's per-frame diff with no invalidation.

/** A one-triangle geometry with `targetCount` morph targets (unique per call). */
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

describe('morph weight-slot plumbing (store lane 20)', () => {
  it('keeps existing offsets still when new morphed meshes join', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'morph-slot-stable',
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
      const indexA = meshA.morph!._weightIndex;
      expect(weightLane(view3d, meshA)).toBe(indexA);

      // A second morphed geometry packs into the arena reservation — nothing
      // about meshA moves.
      const meshB = new Mesh3D({ geometry: createMorphedTriangle(2), material });
      view3d.root.addChild(meshB);
      app.render();

      expect(meshA.morph!._weightIndex).toBe(indexA);
      expect(weightLane(view3d, meshA)).toBe(indexA);
      expect(weightLane(view3d, meshB)).toBe(meshB.morph!._weightIndex);
      expect(meshB.morph!._weightIndex).not.toBe(indexA);

      // Morphed geometry is a first-class citizen: atlased, registered in the
      // geometry store, and its row carries the per-geometry morph facts.
      const geometry = meshA.geometry;
      expect(geometry._geometryDataIndex).toBeGreaterThanOrEqual(0);
      expect(geometry._geometryAtlasAllocation).toBeTruthy();
      const geomStore = getPipe(app).geometryDataStoreBuffer;
      const rowBase = geometry._geometryDataIndex * GEOMETRY_DATA_STRIDE;
      expect(geomStore.u32Data[rowBase + 4]).toBe(geometry._morphDeltaBase);
      expect(geomStore.u32Data[rowBase + 5]).toBe(2);
      expect(geomStore.u32Data[rowBase + 6]).toBe(geometry._geometryAtlasAllocation!.baseVertex);
      // Sphere expanded by the conservative morph reach — never negative here.
      expect(geomStore.data[rowBase + 3]).toBeGreaterThan(0);
    } finally {
      app.destroy();
    }
  });

  it('registers dynamic morphed geometry with a no-cull sentinel', async () => {
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

      // Dynamic keeps it out of the atlas but no longer out of the store: the
      // row exists (morph texel live, baseVertex 0 = already vertex-local) with
      // a sentinel radius so it is never frustum-culled.
      expect(geometry.dynamic).toBe(true);
      expect(geometry._geometryAtlasAllocation).toBeFalsy();
      expect(geometry._geometryDataIndex).toBeGreaterThanOrEqual(0);
      const geomStore = getPipe(app).geometryDataStoreBuffer;
      const rowBase = geometry._geometryDataIndex * GEOMETRY_DATA_STRIDE;
      expect(geomStore.data[rowBase + 3]).toBeLessThan(0);
      expect(geomStore.u32Data[rowBase + 6]).toBe(0);

      // And it morphs: slot allocated, weights diffed into the shared store.
      const morph = mesh.morph!;
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

      // A and D share a weight-count bucket (4); B and C must not move when A goes.
      const material = new Material3D({ baseColor: 0xffffff });
      const meshA = new Mesh3D({ geometry: createMorphedTriangle(4), material });
      const meshB = new Mesh3D({ geometry: createMorphedTriangle(3), material });
      const meshC = new Mesh3D({ geometry: createMorphedTriangle(2), material });
      view3d.root.addChild(meshA);
      view3d.root.addChild(meshB);
      view3d.root.addChild(meshC);

      app.render();
      const indexA = meshA.morph!._weightIndex;
      const indexB = meshB.morph!._weightIndex;
      const indexC = meshC.morph!._weightIndex;

      view3d.root.removeChild(meshA);
      expect(meshA.morph!._slot).toBe(-1); // slot released with scene membership

      app.render();
      expect(meshB.morph!._weightIndex).toBe(indexB);
      expect(meshC.morph!._weightIndex).toBe(indexC);
      expect(weightLane(view3d, meshB)).toBe(indexB);
      expect(weightLane(view3d, meshC)).toBe(indexC);

      // Same bucket as A → the freed slot is reused, not fresh space.
      const meshD = new Mesh3D({ geometry: createMorphedTriangle(4), material });
      view3d.root.addChild(meshD);
      app.render();
      expect(meshD.morph!._weightIndex).toBe(indexA);
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
      const indexA = meshA.morph!._weightIndex;
      const slotA = meshA.morph!._slot;

      // 3 verts × 340 targets × 4 floats = 4080 — with meshA's 24 already
      // packed this overflows the 4096-float default reservation, doubling the
      // arena and shifting every weight slot's absolute offset.
      const big = new Mesh3D({ geometry: createMorphedTriangle(340), material });
      view3d.root.addChild(big);
      app.render();

      const store = getPipe(app)._morphStoreBuffer as unknown as { _deltaCapacity: number };
      expect(store._deltaCapacity).toBeGreaterThan(4096);
      expect(meshA.morph!._slot).toBe(slotA); // relative slot survives the move
      expect(meshA.morph!._weightIndex).not.toBe(indexA); // absolute offset shifted...
      expect(weightLane(view3d, meshA)).toBe(meshA.morph!._weightIndex); // ...and the row followed
      expect(weightLane(view3d, big)).toBe(big.morph!._weightIndex);
    } finally {
      app.destroy();
    }
  });

  it('picks up bare weight mutations via the per-frame diff — no invalidate call', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'morph-weights-diff',
      appOptions: { preference: 'webgpu', width: 128, height: 128 },
    });
    try {
      const view3d = new View3D({ width: 128, height: 128 });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 5);

      const mesh = new Mesh3D({
        geometry: createMorphedTriangle(2),
        material: new Material3D({ baseColor: 0xffffff }),
      });
      mesh.weights![0] = 0.25;
      view3d.root.addChild(mesh);

      app.render();
      const store = getPipe(app)._morphStoreBuffer;
      expect(store.data[mesh.morph!._weightIndex]).toBeCloseTo(0.25);

      // The walk diffs weights against the slot each frame, so a raw array
      // write lands on the next render with no invalidation ceremony.
      mesh.weights![0] = 0.75;
      app.render();
      expect(store.data[mesh.morph!._weightIndex]).toBeCloseTo(0.75);
    } finally {
      app.destroy();
    }
  });
});
