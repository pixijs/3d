import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function drawOrder(view3d: View3D): number[] {
  const list = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE];
  const view = list.view;
  const uidByRow = new Map<number, number>();
  for (let i = 0; i < view.count; i++) {
    const item = view.items[view.renderableIndices[i]];
    uidByRow.set(item._storeIndex, item.uid);
  }

  return Array.from(list.records.subarray(0, view.count), (row) => uidByRow.get(row)!);
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`cutout re-key on an alphaMode change (${preference})`, () => {
    it('moves a mesh to the end of the opaque draw list when its material becomes a cutout, and back', async () => {
      const app = await getApp<Renderer>({
        id: `cutout-rekey-${preference}`,
        appOptions: { preference, width: 64, height: 64 },
      });

      try {
        const view3d = new View3D({ width: 64, height: 64 });
        app.stage.addChild(view3d);

        const geometry = new CubeGeometry({ width: 1, height: 1, depth: 1 });
        const plain = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0xff0000 }) });
        const specular = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0x00ff00, specular: {} }) });
        plain.position.set(-1, 0, 0);
        specular.position.set(1, 0, 0);
        view3d.root.addChild(plain, specular);
        view3d.camera.position.set(0, 0, 5);

        expect(
          specular.material._textures.length,
          "specular's extra texture slot sorts it after plain, so only the cutout bit can move plain last",
        ).toBeGreaterThan(plain.material._textures.length);

        app.render();
        expect(drawOrder(view3d)).toEqual([plain.uid, specular.uid]);

        plain.material.alphaMode = 'mask';
        app.render();
        expect(drawOrder(view3d)).toEqual([specular.uid, plain.uid]);

        plain.material.alphaMode = 'opaque';
        app.render();
        expect(drawOrder(view3d)).toEqual([plain.uid, specular.uid]);
      } finally {
        app.destroy();
      }
    });
  });
}
