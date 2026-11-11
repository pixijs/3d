import { encoded, getApp, readCanvasPixels, ScaleEffect } from '@test-utils';
import { Graphics } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { createDefaultGraph3D } from '~/scene/utils/createDefaultGraph3D';
import { View3D } from '~/scene/View3D';

const SIZE = 32;

function flatView(options: ConstructorParameters<typeof View3D>[0]): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE, ...options });
  view3d.root.addChild(
    new Mesh3D({ geometry: new PlaneGeometry({ width: 40, height: 40 }), material: new FlatMaterial() }),
  );
  view3d.camera.position.set(0, 0, 5);
  return view3d;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`tone curve in the output pass (${preference})`, () => {
    async function withApp(id: string, run: (app: Application<Renderer>) => Promise<void> | void): Promise<void> {
      const app = await getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
      });
      try {
        await run(app);
      } finally {
        app.destroy();
      }
    }

    const centre = (app: Application<Renderer>): number => readCanvasPixels(app.canvas, SIZE / 2, SIZE / 2, 1, 1)[0];

    it('dithers the 8-bit result, so a value between two levels shows as a mix of both', async () => {
      await withApp('tone-output-dither', (app) => {
        const between = (128.5 / 255) ** 2.2;
        const view3d = flatView({ toneMapping: 'none', exposure: between, passes: [new ScaleEffect()] });
        app.stage.addChild(view3d);
        try {
          app.render();
          const pixels = readCanvasPixels(app.canvas, 8, 8, 16, 16);
          const reds: number[] = [];
          for (let i = 0; i < pixels.length; i += 4) reds.push(pixels[i]);
          expect(new Set(reds), 'both neighbouring levels appear').toEqual(new Set([128, 129]));
          const mean = reds.reduce((a, b) => a + b, 0) / reds.length;
          expect(Math.abs(mean - 128.5), 'and they average to the value between them').toBeLessThan(0.1);
        } finally {
          view3d.destroy({ children: true, geometry: true, material: true });
        }
      });
    });

    it('keeps light above 1 for a post effect, then encodes once for the effects after the curve', async () => {
      await withApp('tone-output-range', (app) => {
        const view3d = flatView({ toneMapping: 'none', exposure: 4, passes: [new ScaleEffect(0.25)] });
        app.stage.addChild(view3d);
        try {
          app.render();
          expect(centre(app), 'radiance 4 quartered is 1, where an 8-bit scene would have clipped to 1 first').toBe(
            255,
          );

          view3d.passes = [new ScaleEffect(0.25), new ScaleEffect(0.5, 'afterToneMapping')];
          app.render();
          expect(centre(app), 'an afterToneMapping effect halves the encoded value').toBeCloseTo(255 * 0.5, -1);
        } finally {
          view3d.destroy({ children: true, geometry: true, material: true });
        }
      });
    });

    it('looks the same whether the curve runs in the materials or in the output pass', async () => {
      await withApp('tone-output-same', (app) => {
        const view3d = new View3D({ width: SIZE, height: SIZE });
        view3d.root.addChild(
          new Mesh3D({
            geometry: new SphereGeometry({ radius: 1.5 }),
            material: new Material3D({ baseColor: 0xc08040 }),
          }),
          new AmbientLight({ intensity: 0.5 }),
          new DirectionalLight({ intensity: 3 }),
        );
        view3d.camera.position.set(0, 0, 4);
        app.stage.addChild(view3d);
        try {
          app.render();
          const inShader = readCanvasPixels(app.canvas);
          const effect = new ScaleEffect(1);
          view3d.passes = [effect];
          app.render();
          const inOutput = readCanvasPixels(app.canvas);

          let worst = 0;
          for (let i = 0; i < inShader.length; i++) worst = Math.max(worst, Math.abs(inShader[i] - inOutput[i]));
          expect(worst, 'only rounding differs').toBeLessThanOrEqual(2);

          effect.enabled = false;
          app.render();
          expect(readCanvasPixels(app.canvas), 'turning the effect off puts the curve back in the materials').toEqual(
            inShader,
          );
        } finally {
          view3d.destroy({ children: true, geometry: true, material: true });
        }
      });
    });

    it('keeps the curve in the materials when a custom graph leaves the effects out', async () => {
      await withApp('tone-output-custom-graph', (app) => {
        const view3d = flatView({
          toneMapping: 'reinhard',
          passes: [new ScaleEffect(1)],
          graph: (renderer, options) => createDefaultGraph3D(renderer, { ...options, passes: [] }).graph,
        });
        app.stage.addChild(view3d);
        try {
          app.render();
          expect(centre(app), 'Reinhard maps 1 to 0.5, applied once').toBeCloseTo(encoded(0.5), -1);
        } finally {
          view3d.destroy({ children: true, geometry: true, material: true });
        }
      });
    });

    it("keeps light above 1 between afterToneMapping effects under 'custom', where no curve runs", async () => {
      await withApp('tone-output-custom-chain', (app) => {
        const view3d = flatView({
          toneMapping: 'custom',
          exposure: 4,
          passes: [
            new ScaleEffect(1),
            new ScaleEffect(1, 'afterToneMapping'),
            new ScaleEffect(0.25, 'afterToneMapping'),
          ],
        });
        app.stage.addChild(view3d);
        try {
          app.render();
          expect(
            centre(app),
            'radiance 4 quartered is 1; an 8-bit texture between the effects would clip it first',
          ).toBe(255);
        } finally {
          view3d.destroy({ children: true, geometry: true, material: true });
        }
      });
    });

    it('applies a new tone mapping by rebuilding the output pass', async () => {
      await withApp('tone-output-change', (app) => {
        const view3d = flatView({ toneMapping: 'none', passes: [new ScaleEffect(1)] });
        app.stage.addChild(view3d);
        try {
          app.render();
          expect(centre(app)).toBe(255);

          view3d.toneMapping = 'reinhard';
          app.render();
          expect(centre(app), 'Reinhard maps 1 to 0.5').toBeCloseTo(encoded(0.5), -1);
        } finally {
          view3d.destroy({ children: true, geometry: true, material: true });
        }
      });
    });

    it('composites a linear scene over the 2D beneath as the 8-bit scene does', async () => {
      await withApp('tone-output-composite', (app) => {
        const rect = new Graphics().rect(0, 0, SIZE, SIZE).fill(0xff0000);
        const material = new FlatMaterial({ alphaMode: 'blend', alpha: 0.5 });
        const plane = new Mesh3D({ geometry: new PlaneGeometry({ width: 20, height: 40 }), material });
        plane.position.x = -10;
        const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'reinhard', passes: [new ScaleEffect(1)] });
        view3d.root.addChild(plane);
        view3d.camera.position.set(0, 0, 5);
        app.stage.addChild(rect, view3d);
        const pixel = (x: number): number[] => Array.from(readCanvasPixels(app.canvas, x, SIZE / 2, 1, 1));
        try {
          app.render();
          const linearLeft = pixel(SIZE / 4);
          expect(pixel((3 * SIZE) / 4), 'the 2D beneath shows through untouched').toEqual([255, 0, 0, 255]);

          view3d.passes = [];
          app.render();
          const displayLeft = pixel(SIZE / 4);
          const worst = Math.max(...[0, 1, 2].map((i) => Math.abs(linearLeft[i] - displayLeft[i])));
          expect(
            worst,
            'a half-covered pixel keeps its edge: alpha divided out, curved, multiplied back',
          ).toBeLessThanOrEqual(2);
        } finally {
          view3d.destroy({ children: true, geometry: true, material: true });
          rect.destroy();
        }
      });
    });
  });
}
