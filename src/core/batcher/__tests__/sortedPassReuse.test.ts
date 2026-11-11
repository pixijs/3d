import { getApp } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

function renderFrame(app: Application<Renderer>, view3d: View3D): Uint8Array {
  return new Uint8Array(app.renderer.extract.pixels(view3d).pixels);
}

function hasColor(frame: Uint8Array, channel: number): boolean {
  for (let i = 0; i < frame.length; i += 4) {
    let match = true;
    for (let c = 0; c < 3; c++) match &&= c === channel ? frame[i + c] > 128 : frame[i + c] < 64;
    if (match) return true;
  }
  return false;
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`a pass sorted by distance (${preference})`, () => {
    it('replays its commands while the depth order holds, and rebuilds when the order changes', async () => {
      const app = await getApp<Renderer>({
        id: `sorted-pass-reuse-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 10);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

        const geometry = new CubeGeometry({ width: 0.4, height: 0.4, depth: 0.4 });
        const materials = [0xff0000, 0x0000ff].map((baseColor) => new FlatMaterial({ baseColor, alphaMode: 'blend' }));
        for (let i = 0; i < 6; i++) {
          const mesh = new Mesh3D({ geometry, material: materials[i % 2], castShadow: false });
          mesh.position.set((i - 2.5) * 0.3, 0, -i * 1.5);
          view3d.root.addChild(mesh);
        }
        app.render();

        const list = view3d._sceneBatch.drawLists[RenderPassBit.TRANSPARENT];
        const built = list.commandList.dirtyId;
        const order = () => Array.from(list.view.indices.subarray(0, list.view.count));
        const first = order();

        app.render();
        expect(list.commandList.dirtyId, 'a still camera replays the commands').toBe(built);

        view3d.camera.position.x += 0.05;
        app.render();
        expect(order(), 'a small move keeps the depth order').toEqual(first);
        expect(list.commandList.dirtyId, 'so the commands replay').toBe(built);

        view3d.camera.position.set(0, 0, -20);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
        app.render();
        expect(order(), 'from behind, the order reverses').toEqual([...first].reverse());
        expect(list.commandList.dirtyId, 'and the commands rebuild in it').toBeGreaterThan(built);
      } finally {
        app.destroy();
      }
    });

    it('draws a replayed frame as the frame that built it, with two batches in the pass', async () => {
      const app = await getApp<Renderer>({
        id: `sorted-pass-replay-pixels-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000 },
      });

      try {
        const view3d = new View3D({ toneMapping: 'none', width: SIZE, height: SIZE, cull: 'off' });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 6);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const colors = [0xff0000, 0x0000ff];
        for (let i = 0; i < colors.length; i++) {
          const material = new FlatMaterial({ baseColor: colors[i], alphaMode: 'blend' });
          const mesh = new Mesh3D({ geometry, material, castShadow: false });
          mesh.position.set(-1.5 + i * 1.5, 0, -i);
          view3d.root.addChild(mesh);
        }
        const batched = new BatchedMesh3D({ size: 1 });
        batched.setGeometryAt(0, geometry);
        batched.setMaterialAt(0, new FlatMaterial({ baseColor: 0x00ff00, alphaMode: 'blend' }));
        batched.setMatrixAt(0, new Matrix4());
        batched.setPassesAt(0, RenderPassBit.TRANSPARENT);
        batched.position.set(1.5, 0, 0);
        view3d.root.addChild(batched);

        const built = renderFrame(app, view3d);
        expect(hasColor(built, 0) && hasColor(built, 1) && hasColor(built, 2), 'every cube drew').toBe(true);
        const lists = [view3d._sceneBatch, batched.batch].map((b) => b.drawLists[RenderPassBit.TRANSPARENT]);
        const builtIds = lists.map((list) => list.commandList.dirtyId);

        const replayed = renderFrame(app, view3d);
        expect(
          lists.map((list) => list.commandList.dirtyId),
          'nothing moved, so both batches replay',
        ).toEqual(builtIds);

        let changed = 0;
        for (let i = 0; i < built.length; i++) if (built[i] !== replayed[i]) changed++;
        expect(changed, 'each batch replays against its own buffers').toBe(0);
      } finally {
        app.destroy();
      }
    });
  });
}
