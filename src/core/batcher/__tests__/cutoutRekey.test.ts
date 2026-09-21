import { getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// A pass recomputes a mesh's sort key when the mesh is dirty, not every frame, so drawing
// cutouts last only holds if changing `alphaMode` marks the mesh dirty again. Two meshes share
// a geometry and start opaque. One turns into a cutout and back, and the opaque pass's draw
// order has to follow.
//
// The two materials declare a different number of texture slots, the only key field above the
// pipeline. `plain` declares four and `specular` five, so `plain` sorts first on its layout
// alone, whatever ids the pipeline counter hands them. A move to the end can then only be the
// cutout bit. Sharing a layout instead would prove nothing, because turning a mesh into a
// cutout compiles a new shader, and the newer pipeline id would move it last by itself.

/** Uids of the scene batch's opaque meshes in draw order */
function drawOrder(view3d: View3D): number[] {
  const view = view3d._sceneBatch.drawLists[RenderPassBit.OPAQUE].view;
  const order: number[] = [];

  // After a sort, `items[indices[i]]` is the i-th mesh drawn.
  for (let i = 0; i < view.count; i++) order.push(view.items[view.indices[i]].uid);

  return order;
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`cutout re-key (${preference})`, () => {
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
        // The specular group declares one more texture slot than the base PBR four.
        const specular = new Mesh3D({ geometry, material: new Material3D({ baseColor: 0x00ff00, specular: {} }) });
        plain.position.set(-1, 0, 0);
        specular.position.set(1, 0, 0);
        view3d.root.addChild(plain, specular);
        view3d.camera.position.set(0, 0, 5);

        // Layout, not pipeline, separates these two. The draw order below rests on that.
        expect(specular.material._textures.length).toBeGreaterThan(plain.material._textures.length);

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
