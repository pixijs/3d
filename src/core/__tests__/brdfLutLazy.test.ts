import { getApp, readCanvasPixels } from '@test-utils';
import { RendererType } from 'pixi.js';
import type { Application, Renderer, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 64;

/** The pipe's lookup texture, which is private */
function brdfLut(app: Application<Renderer>): Texture | undefined {
  const pipes = app.renderer.renderPipes as unknown as Record<string, { _brdfLutTexture?: Texture }>;
  return pipes.view3d._brdfLutTexture;
}

/** Brightness of the canvas's centre pixel, from 0 to 255 */
function centreBrightness(canvas: HTMLCanvasElement): number {
  const [r, g, b] = readCanvasPixels(canvas, canvas.width / 2, canvas.height / 2, 1, 1);
  return Math.max(r, g, b);
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`BRDF lookup (${preference})`, () => {
    it('is not made at the first render, only once a view has an environment, and is made once', async () => {
      const app = await getApp<Renderer>({
        id: `brdf-lut-lazy-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
      });
      const view3d = new View3D({ width: SIZE, height: SIZE });

      try {
        expect(app.renderer.type).toBe(preference === 'webgpu' ? RendererType.WEBGPU : RendererType.WEBGL);
        app.stage.addChild(view3d);

        /**
         * Clearcoated on purpose: with no environment its shader still fetches the lookup, from the
         * slot's placeholder, and has to draw all the same
         */
        const sphere = new Mesh3D({
          geometry: new SphereGeometry({ radius: 1 }),
          material: new Material3D({
            baseColor: 0xffffff,
            metallic: 0,
            roughness: 0.5,
            clearcoat: { factor: 1, roughness: 0.1 },
          }),
          castShadow: false,
          receiveShadow: false,
        });
        view3d.root.addChild(sphere);

        const sun = new DirectionalLight({ color: 0xffffff, intensity: 6 });
        sun.rotation.set(-0.4, 0.3, 0);
        sun.rotationDirty = true;
        view3d.root.addChild(sun);

        view3d.camera.position.set(0, 0, 3);

        app.render();
        expect(brdfLut(app)).toBeUndefined();
        expect(centreBrightness(app.canvas)).toBeGreaterThan(64);

        sun.intensity = 0;
        app.render();
        expect(brdfLut(app)).toBeUndefined();
        expect(centreBrightness(app.canvas)).toBeLessThan(8);

        const environment = { skyColor: 0xffffff, groundColor: 0xffffff };
        view3d.environment = environment;
        app.render();
        const made = brdfLut(app);
        expect(made).toBeDefined();
        expect(centreBrightness(app.canvas)).toBeGreaterThan(64);

        view3d.environment = null;
        app.render();
        expect(centreBrightness(app.canvas)).toBeLessThan(8);

        view3d.environment = environment;
        app.render();
        expect(centreBrightness(app.canvas)).toBeGreaterThan(64);
        expect(brdfLut(app)).toBe(made);
      } finally {
        view3d.destroy({ children: true, geometry: true, material: true });
        app.destroy(true);
      }
    });
  });
}
