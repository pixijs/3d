import { getApp, readCanvasPixels } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Material3DOptions } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;
const OFF_PEAK = 36;

function brightness(canvas: HTMLCanvasElement, x: number, y: number): number {
  const [r, g, b] = readCanvasPixels(canvas, x, y, 1, 1);
  return Math.max(r, g, b);
}

const cases: { name: string; material: Material3DOptions; intensity: number }[] = [
  {
    name: 'a smooth clearcoat',
    material: { baseColor: 0x000000, metallic: 0, roughness: 1, clearcoat: { factor: 1, roughness: 0.1 } },
    intensity: 1,
  },
  {
    name: 'a smooth metal',
    material: { baseColor: 0xffffff, metallic: 1, roughness: 0.05 },
    intensity: 0.5,
  },
];

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`GGX highlight (${preference})`, () => {
    for (const { name, material, intensity } of cases) {
      it(`keeps the full peak on ${name}`, async () => {
        const app = await getApp<Renderer>({
          id: `smooth-highlight-${name}-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
        });
        const view3d = new View3D({ width: SIZE, height: SIZE });

        try {
          app.stage.addChild(view3d);
          view3d.root.addChild(
            new Mesh3D({
              geometry: new SphereGeometry({ radius: 1, widthSegments: 64, heightSegments: 48 }),
              material: new Material3D(material),
              castShadow: false,
              receiveShadow: false,
            }),
          );
          view3d.root.addChild(new DirectionalLight({ color: 0xffffff, intensity }));
          view3d.camera.fov = 40;
          view3d.camera.position.set(0, 0, 3);

          app.render();

          expect(brightness(app.canvas, SIZE / 2, SIZE / 2)).toBeGreaterThan(250);
          expect(brightness(app.canvas, SIZE / 2 + OFF_PEAK, SIZE / 2)).toBeLessThan(64);
        } finally {
          view3d.destroy({ children: true, geometry: true, material: true });
          app.destroy(true);
        }
      });
    }
  });
}
