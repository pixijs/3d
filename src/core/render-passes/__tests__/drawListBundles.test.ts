import { expectCleanRender, getApp, renderFrame } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, Renderer, WebGPURenderer } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cpuSubmission } from '~/core/cull';
import type { ForwardRenderPass } from '~/core/render-passes/ForwardRenderPass';
import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

async function threeKinds(id: string) {
  const app = await getApp<Renderer>({
    id: `${id}-webgpu`,
    appOptions: { preference: 'webgpu', width: 128, height: 128, backgroundColor: 0x000000 },
  });
  const view3d = new View3D({ width: 128, height: 128, cull: 'off' });
  app.stage.addChild(view3d);
  const sun = new DirectionalLight({ intensity: 4, castShadow: true });
  sun.rotation.set(-Math.PI / 4, Math.PI / 5, 0);
  view3d.root.addChild(sun);
  view3d.camera.position.set(0, 0, 9);

  const material = new Material3D({ baseColor: 0xff8800, roughness: 0.5 });
  let geometries: CubeGeometry[];
  do {
    geometries = [0.6, 0.8, 1].map((size) => new CubeGeometry({ width: size, height: size, depth: size }));
  } while ((geometries[0].uid & 0xff) > (geometries[2].uid & 0xff));
  const meshes = geometries.flatMap((geometry, g) =>
    [0, 1].map((i) => {
      const mesh = new Mesh3D({ geometry, material });
      mesh.position.set(g * 2 - 2, i * 2 - 1, 0);
      return mesh;
    }),
  );
  view3d.root.addChild(...meshes);
  app.render();

  const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
  expect(list.commandList.count, 'one command per geometry').toBe(3);

  return { app, view3d, meshes, list };
}

function canvasTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ff8800';
  context.fillRect(0, 0, 2, 2);
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function stranger(geometry: Geometry3D, color = 0x00ff00): Mesh3D {
  const mesh = new Mesh3D({
    geometry,
    material: new Material3D({ baseColor: color, baseColorTexture: canvasTexture() }),
  });
  mesh.position.set(((color >> 4) % 7) * 0.5 - 1.5, -2, 0);
  return mesh;
}

async function expectSameAsRebuild(
  app: Application<Renderer>,
  view3d: View3D,
  edited: Uint8ClampedArray,
): Promise<void> {
  expect(
    edited.some((channel, i) => i % 4 !== 3 && channel > 0),
    'the frame draws something',
  ).toBe(true);
  view3d._sceneBatch.invalidateDrawCaches();
  expect(Array.from(edited), 'the edited list draws what a rebuild draws').toEqual(Array.from(await renderFrame(app)));
}

describe('draw list edits with WebGPU bundles', () => {
  afterEach(() => {
    delete cpuSubmission.forward;
  });

  function watchBundles(app: Application<Renderer>) {
    const beginBundle = vi.spyOn((app.renderer as WebGPURenderer).encoder, 'beginBundle');
    return () => beginBundle.mock.calls.filter(([label]) => String(label).startsWith('view3d pass')).length;
  }

  it('keeps an indirect bundle across a removal', async () => {
    const { app, view3d, meshes } = await threeKinds('edit-bundle-indirect');
    try {
      app.render();
      const result = (view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass).cullResults.get(view3d._sceneBatch)!;
      expect(result.bundle, 'the pass records an indirect bundle').not.toBeNull();
      const recordings = watchBundles(app);

      view3d.root.removeChild(meshes[1]);
      const edited = await renderFrame(app);

      expect(recordings(), 'nothing re-records').toBe(0);
      await expectSameAsRebuild(app, view3d, edited);
    } finally {
      app.destroy();
    }
  });

  it('keeps the bundle when a new kind joins and leaves, drawing the tail live after it', async () => {
    const { app, view3d, meshes } = await threeKinds('tail-bundle');
    try {
      app.render();
      const result = (view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass).cullResults.get(view3d._sceneBatch)!;
      expect(result.bundle, 'the pass records an indirect bundle').not.toBeNull();
      const recordings = watchBundles(app);
      const drawIndirect = vi.spyOn((app.renderer as WebGPURenderer).encoder, 'drawIndirect');
      const mesh = stranger(meshes[0].geometry, 0x00ff00);

      view3d.root.addChild(mesh);
      app.render();
      expect(recordings(), 'nothing re-records').toBe(0);
      expect(drawIndirect.mock.calls.length, 'only the opaque tail command draws live').toBe(1);
      drawIndirect.mockClear();

      view3d.root.removeChild(mesh);
      const edited = await renderFrame(app);
      expect(recordings(), 'still nothing re-records').toBe(0);
      expect(drawIndirect.mock.calls.length, 'no tail left to draw live').toBe(0);
      await expectSameAsRebuild(app, view3d, edited);
    } finally {
      app.destroy();
    }
  });

  it('keeps the bundle through body edits while a tail stands', async () => {
    const { app, view3d, meshes } = await threeKinds('tail-standing');
    try {
      view3d.root.addChild(stranger(meshes[0].geometry, 0x00ff00));
      app.render();
      const result = (view3d.passByBit[RenderPassBit.OPAQUE] as ForwardRenderPass).cullResults.get(view3d._sceneBatch)!;
      expect(result.bundle, 'the pass records an indirect bundle').not.toBeNull();
      const recordings = watchBundles(app);

      for (let frame = 0; frame < 3; frame++) {
        if (frame % 2 === 0) view3d.root.removeChild(meshes[1]);
        else view3d.root.addChild(meshes[1]);
        app.render();
      }
      view3d.root.addChild(meshes[1]);
      const edited = await renderFrame(app);

      expect(recordings(), 'nothing re-records').toBe(0);
      await expectSameAsRebuild(app, view3d, edited);
    } finally {
      app.destroy();
    }
  });

  it('re-records a bundle of direct draws once, since it baked the ranges', async () => {
    cpuSubmission.forward = Infinity;
    const { app, view3d, meshes } = await threeKinds('edit-bundle-direct');
    try {
      view3d.cull = 'off';
      app.render();
      app.render();
      const recordings = watchBundles(app);

      view3d.root.removeChild(meshes[1]);
      const edited = await renderFrame(app);
      expect(recordings(), 'one re-record on the edit frame').toBe(1);

      app.render();
      expect(recordings(), 'none after it').toBe(1);
      await expectSameAsRebuild(app, view3d, edited);
    } finally {
      app.destroy();
    }
  });

  it('re-records a bundle recorded while a command was dead once that command revives', async () => {
    const { app, view3d, meshes } = await threeKinds('edit-revive-bundle');
    try {
      view3d.root.removeChild(meshes[2], meshes[3]);
      app.render();
      view3d._sceneBatch.invalidateBundleCaches();
      app.render();
      const recordings = watchBundles(app);

      view3d.root.addChild(meshes[3]);
      const edited = await renderFrame(app);

      expect(recordings(), 'the bundle that left it out re-records, once').toBe(1);
      await expectSameAsRebuild(app, view3d, edited);
    } finally {
      app.destroy();
    }
  });

  it('leaves a dead command out of a later recording, so a destroyed material is never bound', async () => {
    const { app, view3d, meshes, list } = await threeKinds('edit-dead-destroyed');
    try {
      const own = new Material3D({ baseColor: 0x3388ff });
      meshes[2].material = own;
      meshes[3].material = own;
      app.render();
      view3d._sceneBatch.invalidateDrawCaches();
      app.render();
      expect(list.commandList.commands[1].batchBindGroup, 'the second kind draws with its own material').toBe(
        own._getBindGroup(),
      );

      view3d.root.removeChild(meshes[2], meshes[3]);
      app.render();

      own.destroy();
      view3d._sceneBatch.invalidateBundleCaches();
      const drawIndirect = vi.spyOn((app.renderer as WebGPURenderer).encoder, 'drawIndirect');
      await expectCleanRender(app);
      expect(
        drawIndirect.mock.calls.length,
        'the re-recorded opaque and shadow bundles each draw their two live commands and skip the dead one',
      ).toBe(4);
      await expectSameAsRebuild(app, view3d, await renderFrame(app));
    } finally {
      app.destroy();
    }
  });
});
