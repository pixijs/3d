import { getApp } from '@test-utils';
import type { Buffer, Renderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { Mesh3DBatch } from '~/core/batcher/Mesh3DBatch';
import type { CullResults } from '~/core/render-passes/CullResults';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { SpotLight } from '~/scene/lights/SpotLight';
import { Mesh3D } from '~/scene/Mesh3D';
import type { CullMode } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

type Preference = 'webgl' | 'webgpu';

interface CullScene {
  view3d: View3D;
  batched: BatchedMesh3D;
  spot: SpotLight;
}

function buildScene(viewCull: CullMode, batchCull?: CullMode): CullScene {
  const view3d = new View3D({ width: SIZE, height: SIZE, cull: viewCull });
  view3d.camera.position.set(0, 0, 10);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  const geometry = new CubeGeometry();
  const material = new Material3D({ baseColor: 0xc06c4a });
  const batched = new BatchedMesh3D({ size: 2, cull: batchCull });
  const away = new Matrix4();
  away.elements[12] = 1000;
  batched.setMatrixAt(1, away);
  for (let i = 0; i < 2; i++) {
    batched.setGeometryAt(i, geometry);
    batched.setMaterialAt(i, material);
    batched.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
  }
  view3d.root.addChild(batched);

  const offscreen = new Mesh3D({ geometry, material, castShadow: true });
  offscreen.position.set(-1000, 0, 0);
  view3d.root.addChild(offscreen);

  const spot = new SpotLight({ range: 20, coneAngle: 40, castShadow: true });
  spot.position.set(0, 0, 8);
  view3d.root.addChild(spot);
  spot.lookAt({ x: 0, y: 0, z: 0 });

  return { view3d, batched, spot };
}

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

async function drawn(
  renderer: Renderer,
  preference: Preference,
  { view3d, spot }: CullScene,
  batch: Mesh3DBatch,
  bit: number,
): Promise<number> {
  const list = batch.drawLists[bit];
  const commandCount = list.commandList.count;
  let counts = list.drawData.drawCalls;
  if (preference === 'webgpu') {
    const results =
      bit === RenderPassBit.SHADOW
        ? (spot._gpuShadowData as { cullResults?: CullResults }).cullResults!
        : (view3d.passByBit[bit] as ForwardRenderPass).cullResults;
    const result = results.get(batch)!;
    counts = result.direct
      ? result.indirectDrawData.drawCalls
      : await readGpuU32(renderer as WebGPURenderer, result.indirectDrawData.drawCallsBuffer, commandCount * 5 * 4);
  }
  let n = 0;
  for (let k = 0; k < commandCount; k++) n += counts[k * 5 + 1];
  return n;
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`BatchedMesh3D.cull (${preference})`, () => {
    it("is off by default, whatever the view's mode; the view's mode covers its plain meshes", async () => {
      const app = await getApp<Renderer>({
        id: `batched-cull-default-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const scene = buildScene('gpu');
        const { view3d, batched } = scene;
        app.stage.addChild(view3d);
        app.render();

        expect(batched.cull).toBe('off');
        expect(await drawn(app.renderer, preference, scene, batched.batch, RenderPassBit.OPAQUE)).toBe(2);
        expect(await drawn(app.renderer, preference, scene, batched.batch, RenderPassBit.SHADOW)).toBe(2);
        expect(await drawn(app.renderer, preference, scene, view3d._sceneBatch, RenderPassBit.OPAQUE)).toBe(0);
        expect(await drawn(app.renderer, preference, scene, view3d._sceneBatch, RenderPassBit.SHADOW)).toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('switches a batch between modes from the next render, in every pass, without rebuilding', async () => {
      const app = await getApp<Renderer>({
        id: `batched-cull-switch-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const scene = buildScene('off');
        const { view3d, batched } = scene;
        app.stage.addChild(view3d);
        app.render();
        const opaque = batched.batch.drawLists[RenderPassBit.OPAQUE];
        const commandListDirtyId = opaque.commandList.dirtyId;

        for (const mode of ['gpu', 'cpu'] as const) {
          batched.cull = mode;
          app.render();
          expect(await drawn(app.renderer, preference, scene, batched.batch, RenderPassBit.OPAQUE), mode).toBe(1);
          expect(await drawn(app.renderer, preference, scene, batched.batch, RenderPassBit.SHADOW), mode).toBe(1);

          batched.cull = 'off';
          app.render();
          expect(await drawn(app.renderer, preference, scene, batched.batch, RenderPassBit.OPAQUE), mode).toBe(2);
          expect(await drawn(app.renderer, preference, scene, batched.batch, RenderPassBit.SHADOW), mode).toBe(2);
        }

        expect(await drawn(app.renderer, preference, scene, view3d._sceneBatch, RenderPassBit.OPAQUE)).toBe(1);
        expect(opaque.commandList.dirtyId, 'a mode switch keeps the command list').toBe(commandListDirtyId);
      } finally {
        app.destroy();
      }
    });

    it("switches a view's mode from the next render", async () => {
      const app = await getApp<Renderer>({
        id: `batched-cull-view-switch-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const scene = buildScene('off');
        const { view3d } = scene;
        app.stage.addChild(view3d);
        app.render();
        expect(await drawn(app.renderer, preference, scene, view3d._sceneBatch, RenderPassBit.OPAQUE)).toBe(1);

        view3d.cull = 'gpu';
        app.render();
        expect(view3d.cull).toBe('gpu');
        expect(await drawn(app.renderer, preference, scene, view3d._sceneBatch, RenderPassBit.OPAQUE)).toBe(0);
        expect(await drawn(app.renderer, preference, scene, view3d._sceneBatch, RenderPassBit.SHADOW)).toBe(0);

        view3d.cull = 'off';
        app.render();
        expect(await drawn(app.renderer, preference, scene, view3d._sceneBatch, RenderPassBit.OPAQUE)).toBe(1);
      } finally {
        app.destroy();
      }
    });
  });
}
