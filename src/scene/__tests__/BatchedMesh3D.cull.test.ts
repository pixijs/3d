import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

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

/** Instances the opaque pass drew from `batch` last render, as WebGL's in-place cull left them */
function drawnGl(batch: BatchedMesh3D['batch']): number {
  const list = batch.drawLists[RenderPassBit.OPAQUE];
  let n = 0;
  for (let k = 0; k < list.commandList.count; k++) n += list.drawData.drawCalls[k * 5 + 1];
  return n;
}

/**
 * A view culling with `viewCull`, a spot casting shadows down onto the origin, and a batch of two
 * shadow-casting slots: one at the origin, one far off to the side. Plus a scene mesh, also off
 * screen, to show the view's own mode.
 */
function buildScene(viewCull: CullMode, batchCull?: CullMode): { view3d: View3D; batched: BatchedMesh3D } {
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
    batched.setItemActive(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
  }
  view3d.root.addChild(batched);

  const offscreen = new Mesh3D({ geometry, material, castShadow: true });
  offscreen.position.set(-1000, 0, 0);
  view3d.root.addChild(offscreen);

  const spot = new SpotLight({ range: 20, coneAngle: 40, castShadow: true });
  spot.position.set(0, 0, 8);
  view3d.root.addChild(spot);
  spot.lookAt({ x: 0, y: 0, z: 0 });

  return { view3d, batched };
}

const producer = (batch: BatchedMesh3D['batch'], bit: number) => batch.drawLists[bit]._cullProducer;

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`BatchedMesh3D.cull (${preference})`, () => {
    it("is off by default, whatever the view's mode; the view's mode covers its plain meshes", async () => {
      const app = await getApp<Renderer>({
        id: `batched-cull-default-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const { view3d, batched } = buildScene('cpu');
        app.stage.addChild(view3d);
        app.render();

        expect(batched.cull).toBe('off');
        expect(producer(batched.batch, RenderPassBit.OPAQUE)).toBe('off');
        expect(producer(batched.batch, RenderPassBit.SHADOW)).toBe('off');
        expect(producer(view3d._sceneBatch, RenderPassBit.OPAQUE)).toBe('cpu');
        expect(producer(view3d._sceneBatch, RenderPassBit.SHADOW)).toBe('cpu');
      } finally {
        app.destroy();
      }
    });

    it("culls a batch that asks to in every pass, in a view that doesn't, from the next render", async () => {
      const app = await getApp<Renderer>({
        id: `batched-cull-own-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const { view3d, batched } = buildScene('off');
        app.stage.addChild(view3d);
        app.render();
        expect(producer(batched.batch, RenderPassBit.OPAQUE)).toBe('off');

        batched.cull = 'cpu';
        app.render();
        expect(producer(batched.batch, RenderPassBit.OPAQUE)).toBe('cpu');
        expect(producer(batched.batch, RenderPassBit.SHADOW)).toBe('cpu');
        expect(producer(view3d._sceneBatch, RenderPassBit.OPAQUE)).toBe('off');
        expect(producer(view3d._sceneBatch, RenderPassBit.SHADOW)).toBe('off');
      } finally {
        app.destroy();
      }
    });
  });
}

describe('BatchedMesh3D.cull draw counts (webgl)', () => {
  it('draws every slot when off, and only the one in view when culling', async () => {
    const app = await getApp<Renderer>({
      id: 'batched-cull-counts-webgl',
      appOptions: { preference: 'webgl', width: SIZE, height: SIZE },
    });

    try {
      const { view3d, batched } = buildScene('cpu');
      app.stage.addChild(view3d);
      app.render();
      expect(drawnGl(batched.batch)).toBe(2);
      expect(drawnGl(view3d._sceneBatch as BatchedMesh3D['batch'])).toBe(0);

      batched.cull = 'cpu';
      app.render();
      expect(drawnGl(batched.batch)).toBe(1);
    } finally {
      app.destroy();
    }
  });
});
