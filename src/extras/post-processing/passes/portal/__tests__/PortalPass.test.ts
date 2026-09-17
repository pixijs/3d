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
 * A portal's passes run only while its entry can be seen: from the front, inside the view frustum,
 * and visible. Off those, nothing is drawn from its camera and nothing is copied into its texture.
 */

function buildPortal(): { view3d: View3D; portal: PortalPass; entry: Mesh3D } {
  const view3d = new View3D({ width: 128, height: 128 });
  const surface = new Material3D({ baseColor: 0x8899aa });

  // Something for the portal camera to draw on the far side.
  const block = new Mesh3D({ geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }), material: surface });
  block.position.set(40, 0.5, -6);
  view3d.root.addChild(block);

  // Both quads face +Z: the entry is looked at from +Z, the exit's +Z side is the far room.
  const entry = new Mesh3D({ geometry: new PlaneGeometry({ width: 3, height: 4 }), material: surface });
  entry.position.set(0, 2, -8);
  view3d.root.addChild(entry);

  const exit = new Mesh3D({ geometry: new PlaneGeometry({ width: 3, height: 4 }), material: surface });
  exit.position.set(40, 2, -10);
  view3d.root.addChild(exit);

  const feed = RenderTexture.create({ width: 128, height: 128, resolution: 1 });
  const portal = new PortalPass({ entry, exit, texture: feed });
  view3d.passes = [portal];

  // In front of the entry, looking at it.
  view3d.camera.position.set(0, 1.7, -2);
  view3d.camera.lookAt({ x: 0, y: 2, z: -8 });

  return { view3d, portal, entry };
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`PortalPass visibility (${preference})`, () => {
    it('draws and copies only while the entry is in view from the front', async () => {
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
        vi.spyOn(pipe, 'copyColor').mockImplementation((handle, session) => {
          copies++;
          copyColor(handle, session);
        });

        const frame = (): [number, number] => {
          portalDraws = 0;
          copies = 0;
          app.render();
          return [portalDraws, copies];
        };

        // Facing the entry: the far side is drawn and copied into the texture.
        expect(frame()).toEqual([1, 1]);

        // Behind the entry: nothing shows through a doorway from its back.
        view3d.camera.position.set(0, 1.7, -14);
        view3d.camera.lookAt({ x: 0, y: 2, z: -8 });
        expect(frame()).toEqual([0, 0]);

        // In front again but looking away: the entry is outside the frustum.
        view3d.camera.position.set(0, 1.7, -2);
        view3d.camera.lookAt({ x: 0, y: 2, z: 20 });
        expect(frame()).toEqual([0, 0]);

        // Looking at it but the entry is hidden.
        view3d.camera.lookAt({ x: 0, y: 2, z: -8 });
        entry.visible = false;
        expect(frame()).toEqual([0, 0]);

        entry.visible = true;
        expect(frame()).toEqual([1, 1]);
      } finally {
        app.destroy();
      }
    });
  });
}
