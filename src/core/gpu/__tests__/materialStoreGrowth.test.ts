import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

describe('material store growth between two Views in one frame, which pixi records into one encoder (WebGPU)', () => {
  it('keeps the texture the first View drew with alive until the frame is submitted, and binds a bigger one for the second', async (ctx) => {
    const app = await getApp<Renderer>({
      id: 'material-store-growth',
      appOptions: { preference: 'webgpu', width: SIZE * 2, height: SIZE },
    });
    const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
    const materials: Material3D[] = [];
    const views: View3D[] = [];

    const addMesh = (view3d: View3D): void => {
      const material = new Material3D({ baseColor: 0xffffff });
      materials.push(material);
      view3d.root.addChild(new Mesh3D({ geometry, material }));
    };

    try {
      if (!('gpu' in app.renderer)) return ctx.skip('WebGPU is unavailable');
      const device = app.renderer.gpu.device;

      for (let i = 0; i < 2; i++) {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        view3d.x = i * SIZE;
        view3d.camera.position.set(0, 0, 4);
        addMesh(view3d);
        app.stage.addChild(view3d);
        views.push(view3d);
      }
      app.render();

      const store = app.renderer.renderPipes.view3d.materialStoreBuffer;
      const lengthBefore = store.data.length;
      const sourceBefore = store.texture.source;

      await device.queue.onSubmittedWorkDone();
      device.pushErrorScope('validation');
      const capacity = Math.ceil(lengthBefore / materials[0].data._f32.length);
      for (let i = 0; i < capacity; i++) addMesh(views[1]);
      app.render();
      const boundFirst = views[0]._gpuData[app.renderer.uid].globalBindGroup.getResource('uMaterialStorage');
      const boundSecond = views[1]._gpuData[app.renderer.uid].globalBindGroup.getResource('uMaterialStorage');
      await device.queue.onSubmittedWorkDone();
      const error = await device.popErrorScope();

      expect(error?.message ?? null).toBeNull();
      expect(store.data.length).toBeGreaterThan(lengthBefore);
      expect(store.texture.source).not.toBe(sourceBefore);
      expect(boundFirst).toBe(sourceBefore);
      expect(boundSecond).toBe(store.texture.source);
    } finally {
      for (const view3d of views) view3d.destroy({ children: true });
      for (const material of materials) material.destroy();
      geometry.destroy();
      app.destroy();
    }
  });
});
