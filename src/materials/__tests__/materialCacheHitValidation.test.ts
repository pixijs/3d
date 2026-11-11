import { getApp } from '@test-utils';
import type { Application, WebGLRenderer, WebGPURenderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

type App = Application<WebGLRenderer | WebGPURenderer>;

const SIZE = 64;

function addCube(view3d: View3D, material: Material3D): void {
  view3d.root.addChild(new Mesh3D({ geometry: new CubeGeometry(), material }));
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`material validation on a shader-cache hit (${preference})`, () => {
    async function afterFirstCube(id: string, run: (app: App, view3d: View3D, cached: number) => void): Promise<void> {
      const app = await getApp<WebGLRenderer | WebGPURenderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 5);

        addCube(view3d, new Material3D({ baseColor: 0xff0000 }));
        app.render();

        const cached = app.renderer.material3d._shaderCache.size;
        expect(cached).toBeGreaterThan(0);
        run(app, view3d, cached);
      } finally {
        app.destroy();
      }
    }

    it('reuses the compiled shader for an identically configured material', async () => {
      await afterFirstCube('cache-hit-reuse', (app, view3d, cached) => {
        addCube(view3d, new Material3D({ baseColor: 0x00ff00 }));

        expect(() => app.render()).not.toThrow();
        expect(app.renderer.material3d._shaderCache.size).toBe(cached);
      });
    });

    it('still rejects a material whose struct no longer matches the cached layout', async () => {
      await afterFirstCube('cache-hit-validation', (app, view3d, cached) => {
        const material = new Material3D({ baseColor: 0x00ff00 });
        material._materialStructSnapshot = 'tampered';
        addCube(view3d, material);

        expect(() => app.render()).toThrow(/construction-time/);
        expect(app.renderer.material3d._shaderCache.size).toBe(cached);
      });
    });
  });
}
