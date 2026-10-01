import { getApp, readCanvasPixels } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';
import type { View3DOptions } from '~/scene/View3D';

const SIZE = 64;

/** Brightness, 0 to 255, of the canvas pixel at the centre of a View placed at x = `left` */
function brightnessAt(canvas: HTMLCanvasElement, left: number): number {
  const [r, g, b] = readCanvasPixels(canvas, left + SIZE / 2, SIZE / 2, 1, 1);
  return Math.max(r, g, b);
}

/** A SIZE × SIZE View3D with a white unlit sphere filling its centre */
function sphereView(options: View3DOptions = {}): View3D {
  const view = new View3D({ width: SIZE, height: SIZE, ...options });
  view.root.addChild(
    new Mesh3D({
      geometry: new SphereGeometry({ radius: 1 }),
      material: new FlatMaterial({ baseColor: 0xffffff }),
    }),
  );
  view.camera.position.set(0, 0, 2);
  return view;
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`View3D visibility and position (${preference})`, () => {
    let app: Application<Renderer>;

    beforeAll(async () => {
      app = await getApp<Renderer>({
        id: `view3d-visibility-${preference}`,
        appOptions: { preference, width: SIZE * 2, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
      });
    });

    afterAll(() => {
      app.destroy(true);
    });

    it('draws once shown after being added hidden', () => {
      const view = sphereView({ visible: false });

      try {
        app.stage.addChild(view);
        app.render();
        expect(brightnessAt(app.canvas, 0)).toBeLessThan(8);

        view.visible = true;
        app.render();
        expect(brightnessAt(app.canvas, 0)).toBeGreaterThan(200);
      } finally {
        view.destroy({ children: true, geometry: true, material: true });
      }
    });

    it('draws at its new position after moving', () => {
      const view = sphereView();

      try {
        app.stage.addChild(view);
        app.render();
        expect(brightnessAt(app.canvas, 0)).toBeGreaterThan(200);

        view.x = SIZE;
        app.render();
        expect(brightnessAt(app.canvas, 0)).toBeLessThan(8);
        expect(brightnessAt(app.canvas, SIZE)).toBeGreaterThan(200);
      } finally {
        view.destroy({ children: true, geometry: true, material: true });
      }
    });
  });
}
