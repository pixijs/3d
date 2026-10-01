import { expectCleanRender, getApp } from '@test-utils';
import type { Renderer, RenderTarget } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

/** Routed like water through the blended-refraction pass; no core material sets that bit, so it is set directly. */
function refractiveCube(): Mesh3D {
  const material = new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 0.1, transmission: { factor: 1 } });
  material._passBit = RenderPassBit.BLENDED_REFRACTION;
  return new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material,
    castShadow: false,
    receiveShadow: false,
  });
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a pass that only depth-tests against the default target, as refraction does (${preference})`, () => {
    it("binds pixi's own target when refraction first appears, without reconfiguring the canvas", async () => {
      const app = await getApp<Renderer>({
        id: `default-target-ro-depth-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101018 },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        app.stage.addChild(view3d);
        view3d.camera.position.set(0, 0, 4);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
        view3d.root.addChild(new DirectionalLight({ intensity: 3 }));

        const opaque = new Mesh3D({
          geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
          material: new Material3D({ baseColor: 0xff8800, metallic: 0, roughness: 0.5 }),
        });
        opaque.position.set(0, 0, -1.5);
        view3d.root.addChild(opaque);
        app.render();

        const canvasSource = app.renderer.renderTarget.renderTarget.colorTexture;
        const init = vi.spyOn(app.renderer.renderTarget.adaptor, 'initGpuRenderTarget');

        view3d.root.addChild(refractiveCube());
        await expectCleanRender(app);
        const overCanvas = init.mock.calls.filter(([target]) => (target as RenderTarget).colorTexture === canvasSource);
        expect(overCanvas).toEqual([]);

        init.mockRestore();
      } finally {
        app.destroy();
      }
    });
  });
}
