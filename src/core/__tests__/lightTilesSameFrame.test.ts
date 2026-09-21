import { getApp, readCanvasPixels } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { PointLight } from '~/scene/lights/PointLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * The light tile masks have to reach the GPU in the frame they are binned for.
 *
 * A reference image can't show this: a still scene draws the same picture from last frame's
 * masks. So a light jumps from one side of a wall to the other between two frames, and the
 * second frame is read straight off the canvas. Masks a frame late still hold the light's old
 * tiles, its bit is clear where it now stands, and its pool of light is missing.
 */

const SIZE = 128;
const EYE_Z = 10;
const WALL_Z = -8;
const LIGHT_Z = WALL_Z + 1.5;
const FOV = 75;

/** Half the view's width at the light's depth */
const EDGE = Math.tan((FOV * Math.PI) / 360) * (EYE_Z - LIGHT_Z);

/** Where the light stands, as a fraction of the way from the screen's centre to its edge */
const OFFSET = 0.6;

/** Brightness, 0 to 255, of the canvas pixels at `xs` along row `y` */
function canvasBrightness(canvas: HTMLCanvasElement, xs: number[], y: number): number[] {
  const data = readCanvasPixels(canvas, 0, y, canvas.width, 1);
  return xs.map((x) => Math.max(data[x * 4], data[x * 4 + 1], data[x * 4 + 2]));
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`light tiles on the GPU (${preference})`, () => {
    it('lights a moved light in the same frame it moved', async () => {
      const app = await getApp<Renderer>({
        id: `light-tiles-same-frame-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
      });

      const view3d = new View3D({ width: SIZE, height: SIZE });
      app.stage.addChild(view3d);

      try {
        const wall = new Mesh3D({
          geometry: new PlaneGeometry({ width: 80, height: 80 }),
          material: new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 0.6 }),
          castShadow: false,
          receiveShadow: false,
        });
        wall.position.set(0, 0, WALL_Z);
        view3d.root.addChild(wall);

        const light = new PointLight({ color: 0xffffff, intensity: 400, range: 3 });
        light.position.set(-EDGE * OFFSET, 0, LIGHT_Z);
        view3d.root.addChild(light);

        view3d.camera.fov = FOV;
        view3d.camera.near = 0.15;
        view3d.camera.far = 120;
        view3d.camera.position.set(0, 0, EYE_Z);

        const leftX = Math.round(SIZE * (0.5 - OFFSET / 2));
        const rightX = Math.round(SIZE * (0.5 + OFFSET / 2));
        const y = SIZE / 2;

        app.render();
        const [leftBefore, rightBefore] = canvasBrightness(app.canvas, [leftX, rightX], y);
        expect(leftBefore).toBeGreaterThan(128);
        expect(rightBefore).toBeLessThan(16);

        light.position.set(EDGE * OFFSET, 0, LIGHT_Z);
        app.render();
        const [leftAfter, rightAfter] = canvasBrightness(app.canvas, [leftX, rightX], y);
        expect(rightAfter).toBeGreaterThan(128);
        expect(leftAfter).toBeLessThan(16);
      } finally {
        view3d.destroy(true);
        app.destroy();
      }
    });
  });
}
