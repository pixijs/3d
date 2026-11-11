import { expectCleanRender, getApp } from '@test-utils';
import type { WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

interface StoreViews {
  _buffer: unknown;
  _texture: unknown;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`store views on demand (${preference})`, () => {
    it('creates only the view the backend binds, for every store', async () => {
      const app = await getApp<WebGLRenderer | WebGPURenderer>({
        id: `store-views-${preference}`,
        appOptions: { preference, width: 32, height: 32 },
      });

      try {
        const view3d = new View3D({ width: 32, height: 32 });
        app.stage.addChild(view3d);
        view3d.root.addChild(
          new Mesh3D({
            geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
            material: new Material3D({ baseColor: 0xffffff }),
          }),
        );
        view3d.camera.position.set(0, 0, 4);
        await expectCleanRender(app);

        const pipe = app.renderer.renderPipes.view3d;
        const stores = {
          mesh: view3d._sceneBatch.storeBuffer,
          geometry: pipe.geometryDataStoreBuffer,
          bones: view3d._bonePit,
          morphs: pipe._morphStoreBuffer,
        };
        const made = Object.fromEntries(
          Object.entries(stores).map(([name, store]) => {
            const { _buffer, _texture } = store as unknown as StoreViews;

            return [name, { buffer: _buffer !== null, texture: _texture !== null }];
          }),
        );
        const other = preference === 'webgpu' ? { buffer: true, texture: false } : { buffer: false, texture: true };

        expect(made).toEqual({
          mesh: other,
          geometry: other,
          bones: other,
          morphs: other,
        });

        view3d.destroy({ children: true });
      } finally {
        app.destroy();
      }
    });
  });
}
