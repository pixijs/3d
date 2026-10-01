import { getApp } from '@test-utils';
import { RenderTexture } from 'pixi.js';
import type { Renderer, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { PortalPass } from '~/extras/post-processing/passes/portal/PortalPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * A view with an entry and an exit 40 apart along x, both facing `+Z`, a block in the far room for the
 * portal camera to draw, and the view camera in front of the entry looking at it
 */
function buildPortal(): { view3d: View3D; portal: PortalPass; entry: Mesh3D } {
  const view3d = new View3D({ width: 128, height: 128 });
  const surface = new Material3D({ baseColor: 0x8899aa });

  const farRoomBlock = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: surface,
  });
  farRoomBlock.position.set(40, 0.5, -6);
  view3d.root.addChild(farRoomBlock);

  const entry = new Mesh3D({ geometry: new PlaneGeometry({ width: 3, height: 4 }), material: surface });
  entry.position.set(0, 2, -8);
  view3d.root.addChild(entry);

  const exit = new Mesh3D({ geometry: new PlaneGeometry({ width: 3, height: 4 }), material: surface });
  exit.position.set(40, 2, -10);
  view3d.root.addChild(exit);

  const feed = RenderTexture.create({ width: 128, height: 128, resolution: 1 });
  const portal = new PortalPass({ entry, exit, texture: feed });
  view3d.passes = [portal];

  view3d.camera.position.set(0, 1.7, -2);
  view3d.camera.lookAt({ x: 0, y: 2, z: -8 });

  return { view3d, portal, entry };
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`PortalPass visibility (${preference})`, () => {
    it('draws and copies only while the entry is visible, in the frustum and seen from the front', async () => {
      const app = await getApp<Renderer>({
        id: `portal-pass-visibility-${preference}`,
        appOptions: { preference, width: 128, height: 128 },
      });

      try {
        const { view3d, portal, entry } = buildPortal();
        app.stage.addChild(view3d);

        const pipe = (app.renderer as WebGLRenderer | WebGPURenderer).renderPipes.view3d;
        const renderForward = pipe.renderForward.bind(pipe);
        const copyColor = pipe.copyColor.bind(pipe);
        let portalDraws = 0;
        let copies = 0;
        vi.spyOn(pipe, 'renderForward').mockImplementation((desc, session) => {
          if (desc.camera === portal.camera) portalDraws++;
          renderForward(desc, session);
        });
        vi.spyOn(pipe, 'copyColor').mockImplementation((source, dest, session) => {
          copies++;
          copyColor(source, dest, session);
        });

        const frame = (): [number, number] => {
          portalDraws = 0;
          copies = 0;
          app.render();
          return [portalDraws, copies];
        };

        expect(frame(), 'facing the entry').toEqual([1, 1]);

        view3d.camera.position.set(0, 1.7, -14);
        view3d.camera.lookAt({ x: 0, y: 2, z: -8 });
        expect(frame(), 'behind the entry').toEqual([0, 0]);

        view3d.camera.position.set(0, 1.7, -2);
        view3d.camera.lookAt({ x: 0, y: 2, z: 20 });
        expect(frame(), 'in front, looking away').toEqual([0, 0]);

        view3d.camera.lookAt({ x: 0, y: 2, z: -8 });
        entry.visible = false;
        expect(frame(), 'facing the hidden entry').toEqual([0, 0]);

        entry.visible = true;
        expect(frame(), 'facing the entry again').toEqual([1, 1]);
      } finally {
        app.destroy();
      }
    });
  });
}
