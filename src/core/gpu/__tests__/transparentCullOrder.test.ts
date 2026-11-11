import { getApp } from '@test-utils';
import type { Buffer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;
const COUNT = 512;

async function readGpuU32(renderer: WebGPURenderer, buffer: Buffer, bytes: number): Promise<Uint32Array> {
  const device = renderer.gpu.device;
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(renderer.buffer.getGPUBuffer(buffer), 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const data = new Uint32Array(staging.getMappedRange()).slice();
  staging.unmap();
  staging.destroy();
  return data;
}

function buildScene(): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE, cull: 'gpu' });
  view3d.camera.position.set(0, 0, 30);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  const geometry = new PlaneGeometry();
  const glass = new Material3D({ baseColor: 0xc06c4a, alphaMode: 'blend', alpha: 0.5 });
  const solid = new Material3D({ baseColor: 0x4a6cc0 });
  for (let i = 0; i < COUNT; i++) {
    const mesh = new Mesh3D({ geometry, material: glass });
    mesh.position.set((i % 11) - 5, (i % 7) - 3, -(((i * 7919) % COUNT) / COUNT) * 20);
    view3d.root.addChild(mesh);
  }
  view3d.root.addChild(new Mesh3D({ geometry, material: solid }));
  return view3d;
}

describe("transparent culling under 'gpu'", () => {
  it('keeps the back-to-front order the CPU sorted', async () => {
    const app = await getApp<WebGPURenderer>({
      id: 'transparent-cull-order',
      appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
    });

    try {
      const view3d = buildScene();
      app.stage.addChild(view3d);
      app.render();

      const batch = view3d._sceneBatch;
      const transparent = batch.drawLists[RenderPassBit.TRANSPARENT];
      expect(transparent.commandList.count).toBe(1);

      const count = transparent.view.count;
      const sorted = transparent.gpuData.instanceBuffer.data;
      const pass = view3d.passByBit[RenderPassBit.TRANSPARENT] as ForwardRenderPass;
      const survivors = await readGpuU32(app.renderer, pass.cullResults.get(batch)!.survivors.buffer, count * 4);

      let misplaced = 0;
      for (let i = 0; i < count; i++) if (survivors[i] !== sorted[i]) misplaced++;
      expect(misplaced).toBe(0);

      view3d.destroy({ children: true });
    } finally {
      app.destroy();
    }
  });
});
