import { expectCleanRender, getApp, readCanvasPixels } from '@test-utils';
import { CanvasSource, Texture } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

type Rgb = [number, number, number];

const COLORS: Rgb[] = [
  [255, 0, 0],
  [0, 255, 0],
];

function solid(rgb: Rgb): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `rgb(${rgb.join(',')})`;
  ctx.fillRect(0, 0, 4, 4);
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

async function withApp(
  preference: 'webgl' | 'webgpu',
  test: (app: Application<Renderer>) => Promise<void>,
): Promise<void> {
  const app = await getApp<Renderer>({
    id: `batch-material-tick-${preference}`,
    appOptions: { preference, width: 64, height: 64, resolution: 1, backgroundColor: 0x000000 },
  });
  try {
    await test(app);
  } finally {
    app.destroy(false, { children: true });
  }
}

function grid(app: Application<Renderer>, materials: FlatMaterial[], geometries: Geometry3D[]) {
  const { width, height } = app.screen;
  const view3d = new View3D({ toneMapping: 'none', width, height });
  view3d.camera.position.set(0, 0, 6);
  const rows = geometries.map((geometry, row) =>
    materials.map((material, i) => {
      const x = (i - (materials.length - 1) / 2) * 3;
      const y = (geometries.length - 1) / 2 - row;
      const mesh = new Mesh3D({ geometry, material, position: { x, y, z: 0 } });
      view3d.root.addChild(mesh);
      return mesh;
    }),
  );
  app.stage.addChild(view3d);
  return { view3d, rows };
}

async function expectColors(app: Application<Renderer>, view3d: View3D, rows: Mesh3D[][], colors: Rgb[]) {
  await expectCleanRender(app);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const pixels = readCanvasPixels(app.canvas);
  for (const row of rows) {
    row.forEach((mesh, i) => {
      const p = view3d.worldToScreen(mesh.position)!;
      const o = (Math.round(p.y) * app.canvas.width + Math.round(p.x)) * 4;
      const actual = [pixels[o], pixels[o + 1], pixels[o + 2]];
      const near = actual.every((channel, c) => Math.abs(channel - colors[i][c]) < 40);
      expect(near, `mesh ${i} of a ${mesh.geometry.constructor.name} drew ${actual.join(',')}`).toBe(true);
    });
  }
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`batcher material tick (${preference})`, () => {
    it('draws a material met again after another one with its own texture', async () => {
      await withApp(preference, async (app) => {
        const materials = COLORS.map((rgb) => new FlatMaterial({ baseColorTexture: solid(rgb) }));
        const { view3d, rows } = grid(app, materials, [
          new CubeGeometry({ width: 1, height: 1, depth: 1 }),
          new SphereGeometry({ radius: 0.6 }),
        ]);

        await expectColors(app, view3d, rows, COLORS);
      });
    });

    it('rebuilds every list that draws a shared material when its texture is unloaded', async () => {
      await withApp(preference, async (app) => {
        const materials = COLORS.map((rgb) => new FlatMaterial({ baseColorTexture: solid(rgb) }));
        const cube = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const { view3d, rows } = grid(app, materials, [cube, new SphereGeometry({ radius: 0.6 })]);
        const other = new View3D({ toneMapping: 'none', width: 64, height: 64 });
        other.root.addChild(new Mesh3D({ geometry: cube, material: materials[0] }));
        app.stage.addChild(other);
        app.render();

        const lists = [view3d, other].map((view) => view._sceneBatch.drawLists[RenderPassBit.OPAQUE]);
        const before = lists.map((list) => list.drawDirtyId);
        materials[0].textures.baseColor!.source.unload();
        expect(
          lists.map((list, i) => list.drawDirtyId > before[i]),
          'each view’s list hears the texture go',
        ).toEqual([true, true]);

        other.destroy({ children: true });
        await expectColors(app, view3d, rows, COLORS);
      });
    });
  });
}
