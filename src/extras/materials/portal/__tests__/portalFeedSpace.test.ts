import { getApp, readCanvasPixels } from '@test-utils';
import { RenderTexture } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { PortalMaterial } from '~/extras/materials/portal/PortalMaterial';
import { PortalPass } from '~/extras/post-processing/passes/portal/PortalPass';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`PortalMaterial reads its feed in the view's output space (${preference})`, () => {
    it("shows a grey wall through the portal as authored, and as linear light under 'custom'", async () => {
      const app = await getApp<Renderer>({
        id: `portal-feed-space-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0, autoStart: false },
      });
      const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });

      try {
        const feed = RenderTexture.create({ width: SIZE, height: SIZE, resolution: 1 });
        const entry = new Mesh3D({
          geometry: new PlaneGeometry({ width: 3, height: 4 }),
          material: new PortalMaterial({ texture: feed }),
        });
        const exit = new Mesh3D({
          geometry: new PlaneGeometry({ width: 3, height: 4 }),
          material: new FlatMaterial({ baseColor: 0x000000 }),
        });
        const wall = new Mesh3D({
          geometry: new PlaneGeometry({ width: 40, height: 40 }),
          material: new FlatMaterial({ baseColor: 0x808080, doubleSided: true }),
        });

        entry.position.set(0, 2, -8);
        exit.position.set(40, 2, -10);
        wall.position.set(40, 2, -7);
        view3d.root.addChild(entry, exit, wall);
        view3d.passes = [new PortalPass({ entry, exit, texture: feed })];
        view3d.camera.position.set(0, 2, -4);
        view3d.camera.lookAt({ x: 0, y: 2, z: -8 });
        app.stage.addChild(view3d);

        const centre = (): number => {
          app.render();

          return readCanvasPixels(app.canvas, SIZE / 2, SIZE / 2, 1, 1)[0];
        };
        const linearGrey = Math.round(Math.pow(128 / 255, 2.2) * 255);

        expect(centre(), "'none'").toBe(128);

        view3d.toneMapping = 'custom';
        expect(Math.abs(centre() - linearGrey), "'custom'").toBeLessThanOrEqual(1);

        view3d.toneMapping = 'none';
        expect(centre(), "'none' again").toBe(128);
      } finally {
        view3d.destroy({ children: true, geometry: true, material: true });
        app.destroy(true);
      }
    });
  });
}
