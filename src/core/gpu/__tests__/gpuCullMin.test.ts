import { getApp } from '@test-utils';
import type { WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gpuCull } from '~/core/cull';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { SpotLight } from '~/scene/lights/SpotLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

const COUNT = 8;

async function litViewOfHalfHiddenCubes(id: string) {
  const app = await getApp<WebGPURenderer>({
    id,
    appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
  });
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
  view3d.camera.position.set(0, 0, 20);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  app.stage.addChild(view3d);
  const spot = new SpotLight({ range: 60, coneAngle: 40, castShadow: true });
  spot.position.set(0, 0, 20);
  view3d.root.addChild(spot);
  spot.lookAt({ x: 0, y: 0, z: 0 });

  const material = new Material3D();
  const cube = new CubeGeometry();
  let added = 0;
  const addCubes = (count: number, castShadow: boolean) => {
    const meshes: Mesh3D[] = [];
    for (let i = 0; i < count; i++, added++) {
      const mesh = new Mesh3D({ geometry: cube, material, castShadow });
      mesh.position.set(added % 2 ? 500 : added - 4, 0, 0);
      meshes.push(view3d.root.addChild(mesh));
    }
    return meshes;
  };
  const dispatch = vi.spyOn(app.renderer.compute3d, 'dispatch');

  return { app, view3d, material, addCubes, dispatch };
}

function survivorsCountedOnCpu(view3d: View3D): number {
  const batch = view3d._sceneBatch;
  const result = (view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass).cullResults.get(batch)!;
  const list = batch.drawLists[RenderPassBit.OPAQUE];
  let drawn = 0;
  for (let k = 0; k < list.commandList.count; k++) drawn += result.indirectDrawData.drawCalls[k * 5 + 1];
  return drawn;
}

describe("'gpu' culling of a small WebGPU view", () => {
  afterEach(() => {
    delete gpuCull.minInstances;
  });

  it('culls a batch under the minimum on the CPU in every pass, still drawing indirect from a bundle', async () => {
    const { app, view3d, material, addCubes, dispatch } = await litViewOfHalfHiddenCubes('gpu-cull-min-under');
    try {
      addCubes(COUNT, true);
      const drawIndirect = vi.spyOn(app.renderer.encoder, 'drawIndirect');
      app.render();

      const result = (view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass).cullResults.get(view3d._sceneBatch)!;

      expect(dispatch, 'no pass dispatches the compute cull').not.toHaveBeenCalled();
      expect(result.direct, 'the draws stay indirect').toBe(false);
      expect(result.bundle).not.toBeNull();
      expect(drawIndirect).toHaveBeenCalled();
      expect(survivorsCountedOnCpu(view3d), 'the four cubes in view survive').toBe(COUNT / 2);
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it('culls every pass of a batch on the GPU once its largest list reaches the minimum', async () => {
    gpuCull.minInstances = COUNT;
    const { app, view3d, material, addCubes, dispatch } = await litViewOfHalfHiddenCubes('gpu-cull-min-at');
    try {
      addCubes(COUNT - 2, false);
      addCubes(2, true);
      app.render();

      expect(dispatch, 'the forward pass and the two-caster shadow list both dispatch').toHaveBeenCalledTimes(2);
      expect(view3d._sceneBatch.storeBuffer.writesSpheres, 'no pass walked on the CPU').toBe(false);
    } finally {
      material.destroy();
      app.destroy();
    }
  });

  it('stops writing CPU spheres once a batch grows to the minimum, and sweeps them when it shrinks back under it', async () => {
    gpuCull.minInstances = COUNT;
    const { app, view3d, material, addCubes, dispatch } = await litViewOfHalfHiddenCubes('gpu-cull-min-grow');
    try {
      const store = view3d._sceneBatch.storeBuffer;
      const first = addCubes(COUNT / 2, true);
      app.render();
      expect(store.writesSpheres, 'the small batch walks on the CPU').toBe(true);
      expect(dispatch).not.toHaveBeenCalled();

      addCubes(COUNT / 2, true);
      app.render();
      expect(store.writesSpheres, 'the grown batch no longer pays for spheres').toBe(false);
      expect(dispatch).toHaveBeenCalled();

      first[0].position.x = 500;
      view3d.root.removeChild(first[1]);
      view3d.root.removeChild(first[3]);
      dispatch.mockClear();
      app.render();
      expect(dispatch, 'the shrunk batch walks on the CPU again').not.toHaveBeenCalled();
      expect(survivorsCountedOnCpu(view3d), 'the cube moved out of view while spheres were off is culled').toBe(3);
    } finally {
      material.destroy();
      app.destroy();
    }
  });
});
