import { getApp } from '@test-utils';
import type { Buffer, Renderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { MESH3D_LANE_VISIBILITY, MESH3D_STORE_STRIDE } from '~/core/buffers/Mesh3DDataStoreBuffer';
import { GPU_VISIBILITY_MIN } from '~/core/gpu/cull';
import type { CullResult } from '~/core/render-passes/CullResult';
import type { CullResults } from '~/core/render-passes/CullResults';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { SpotLight } from '~/scene/lights/SpotLight';
import { View3D } from '~/scene/View3D';

const SIZE = 64;
const SLOTS = 4;

async function readGpuU32(renderer: Renderer, buffer: Buffer, bytes: number): Promise<Uint32Array> {
  const gpuRenderer = renderer as WebGPURenderer;
  const device = gpuRenderer.gpu.device;
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(gpuRenderer.buffer.getGPUBuffer(buffer), 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const data = new Uint32Array(staging.getMappedRange()).slice();
  staging.unmap();
  staging.destroy();
  return data;
}

async function readCounts(renderer: Renderer, result: CullResult, commandCount: number): Promise<number> {
  const drawCalls = await readGpuU32(renderer, result.indirectDrawData.drawCallsBuffer, commandCount * 5 * 4);
  let n = 0;
  for (let k = 0; k < commandCount; k++) n += drawCalls[k * 5 + 1];
  return n;
}

async function drawn(
  renderer: Renderer,
  preference: 'webgl' | 'webgpu',
  view3d: View3D,
  batched: BatchedMesh3D,
): Promise<number> {
  const list = batched.batch.drawLists[RenderPassBit.OPAQUE];
  const commandCount = list.commandList.count;
  if (preference === 'webgpu') {
    const result = (view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass).cullResults.get(batched.batch)!;
    return readCounts(renderer, result, commandCount);
  }
  let n = 0;
  for (let k = 0; k < commandCount; k++) n += list.drawData.drawCalls[k * 5 + 1];
  return n;
}

function buildScene(slots = SLOTS, shadow = false): { view3d: View3D; batched: BatchedMesh3D; spot?: SpotLight } {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.camera.position.set(0, 0, 10);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  const geometry = new CubeGeometry();
  const material = new Material3D({ baseColor: 0xc06c4a });
  const batched = new BatchedMesh3D({ size: slots });
  const matrix = new Matrix4();
  const passes = shadow ? RenderPassBit.OPAQUE | RenderPassBit.SHADOW : RenderPassBit.OPAQUE;
  for (let i = 0; i < slots; i++) {
    matrix.elements[12] = i * 1.5 - 2;
    batched.setMatrixAt(i, matrix);
    batched.setGeometryAt(i, geometry);
    batched.setMaterialAt(i, material);
    batched.setPassesAt(i, passes);
  }
  view3d.root.addChild(batched);
  if (!shadow) return { view3d, batched };

  const spot = new SpotLight({ range: 20, coneAngle: 40, castShadow: true });
  spot.position.set(0, 0, 8);
  view3d.root.addChild(spot);
  spot.lookAt({ x: 0, y: 0, z: 0 });
  return { view3d, batched, spot };
}

describe('BatchedMesh3D.setVisibleAt', () => {
  it('starts every slot visible, and writes a flip into the slot store row', () => {
    const batched = new BatchedMesh3D({ size: SLOTS });
    const store = batched.batch.storeBuffer;
    const lane = (i: number) =>
      store.u32Data[batched.batch.items[i]._storeIndex * MESH3D_STORE_STRIDE + MESH3D_LANE_VISIBILITY];

    expect(batched.getVisibleAt(2)).toBe(true);
    expect(lane(2)).toBe(1);

    const visibilityId = batched.batch._visibilityDirtyId;
    batched.setVisibleAt(2, false);
    expect(batched.getVisibleAt(2)).toBe(false);
    expect(lane(2)).toBe(0);
    expect(batched.batch._visibilityDirtyId).toBe(visibilityId + 1);

    batched.setVisibleAt(2, false);
    expect(batched.batch._visibilityDirtyId, 'an unchanged value is not a flip').toBe(visibilityId + 1);

    batched.destroy();
  });

  for (const preference of ['webgl', 'webgpu'] as const) {
    it(`hides and shows slots without rebuilding a draw list (${preference})`, async () => {
      const app = await getApp<Renderer>({
        id: `batched-set-visible-at-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const { view3d, batched } = buildScene();
        app.stage.addChild(view3d);
        app.render();
        expect(await drawn(app.renderer, preference, view3d, batched)).toBe(SLOTS);

        const list = batched.batch.drawLists[RenderPassBit.OPAQUE];
        const drawDirtyId = list.drawDirtyId;
        const commandListDirtyId = list.commandList.dirtyId;

        batched.setVisibleAt(1, false);
        batched.setVisibleAt(3, false);
        app.render();
        expect(await drawn(app.renderer, preference, view3d, batched)).toBe(SLOTS - 2);

        batched.setVisibleAt(1, true);
        app.render();
        expect(await drawn(app.renderer, preference, view3d, batched)).toBe(SLOTS - 1);

        expect(list.drawDirtyId, 'no draw-list rebuild was asked for').toBe(drawDirtyId);
        expect(list.commandList.dirtyId, 'no draw commands were rebuilt').toBe(commandListDirtyId);
      } finally {
        app.destroy();
      }
    });
  }

  for (const [side, slots] of [
    ['under', GPU_VISIBILITY_MIN - 1],
    ['at', GPU_VISIBILITY_MIN],
  ] as const) {
    it(`compacts a list ${side} the GPU visibility gate to the same counts (webgpu)`, async () => {
      const app = await getApp<Renderer>({
        id: `batched-set-visible-at-gate-${side}`,
        appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
      });

      try {
        const { view3d, batched } = buildScene(slots);
        app.stage.addChild(view3d);
        app.render();
        expect(await drawn(app.renderer, 'webgpu', view3d, batched)).toBe(slots);

        for (let i = 0; i < slots; i += 2) batched.setVisibleAt(i, false);
        app.render();
        expect(await drawn(app.renderer, 'webgpu', view3d, batched)).toBe(slots >> 1);

        batched.setVisibleAt(0, true);
        app.render();
        expect(await drawn(app.renderer, 'webgpu', view3d, batched)).toBe((slots >> 1) + 1);
      } finally {
        app.destroy();
      }
    });
  }

  it('drops hidden slots from the shadow pass of an unculled batch over the gate (webgpu)', async () => {
    const app = await getApp<Renderer>({
      id: 'batched-set-visible-at-shadow',
      appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
    });

    try {
      const slots = GPU_VISIBILITY_MIN;
      const { view3d, batched, spot } = buildScene(slots, true);
      app.stage.addChild(view3d);
      app.render();

      const list = batched.batch.drawLists[RenderPassBit.SHADOW];
      expect(batched.cull).toBe('off');
      const result = (spot!._gpuShadowData as { cullResults?: CullResults }).cullResults!.get(batched.batch)!;
      expect(await readCounts(app.renderer, result, list.commandList.count)).toBe(slots);

      batched.setVisibleAt(0, false);
      batched.setVisibleAt(1, false);
      app.render();
      expect(await readCounts(app.renderer, result, list.commandList.count)).toBe(slots - 2);
    } finally {
      app.destroy();
    }
  });

  it('keeps the back-to-front order of a transparent list over the GPU visibility gate (webgpu)', async () => {
    const app = await getApp<Renderer>({
      id: 'batched-set-visible-at-transparent-order',
      appOptions: { preference: 'webgpu', width: SIZE, height: SIZE },
    });

    try {
      const slots = GPU_VISIBILITY_MIN;
      const { view3d, batched } = buildScene(slots);
      batched.batch.items[0].material.alphaMode = 'blend';
      for (let i = 0; i < slots; i++) batched.setPassesAt(i, RenderPassBit.TRANSPARENT);
      for (let i = 0; i < slots; i += 3) batched.setVisibleAt(i, false);
      app.stage.addChild(view3d);
      app.render();

      const list = batched.batch.drawLists[RenderPassBit.TRANSPARENT];
      expect(list.commandList.count, 'one command, so the survivors are contiguous').toBe(1);

      const records = list.gpuData.instanceBuffer.data;
      const store = batched.batch.storeBuffer.u32Data;
      const expected: number[] = [];
      for (let i = 0; i < list.view.count; i++) {
        const id = records[i];
        if (store[id * MESH3D_STORE_STRIDE + MESH3D_LANE_VISIBILITY] !== 0) expected.push(id);
      }

      const result = (view3d.passByBit[RenderPassBit.TRANSPARENT] as ForwardRenderPass).cullResults.get(batched.batch)!;
      const survivors = await readGpuU32(app.renderer, result.survivors.buffer, expected.length * 4);
      expect(Array.from(survivors)).toEqual(expected);
    } finally {
      app.destroy();
    }
  });
});
