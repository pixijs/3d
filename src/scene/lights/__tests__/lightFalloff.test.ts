import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { LightDataList } from '~/core/LightDataList';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { PointLight } from '~/scene/lights/PointLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const RADIUS_POW4_SLOT = 15;
const SIZE = 64;

describe('light radius → packed light list', () => {
  it('floors the radius at 0.01, so a surface at the light stays lit by a finite amount', () => {
    const list = new LightDataList();
    list.add(new PointLight({ radius: 0 }));

    expect(list.data[RADIUS_POW4_SLOT] ** 0.25).toBeCloseTo(0.01, 6);
  });
});

function redAt(pixels: Uint8ClampedArray, x: number, y: number): number {
  return pixels[(y * SIZE + x) * 4];
}

async function renderWall(preference: 'webgl' | 'webgpu', radii: number[]): Promise<Uint8ClampedArray[]> {
  const app = await getApp<Renderer>({
    id: `light-radius-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
  });

  try {
    const view3d = new View3D({ width: SIZE, height: SIZE });
    app.stage.addChild(view3d);
    view3d.camera.position.set(0, 0, 5);

    const wall = new Mesh3D({
      geometry: new PlaneGeometry({ width: 6, height: 6 }),
      material: new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 1 }),
    });
    view3d.root.addChild(wall);

    const light = new PointLight({ intensity: 0.5 });
    light.position.set(0, 0, 0.3);
    view3d.root.addChild(light);

    const frames: Uint8ClampedArray[] = [];
    for (const radius of radii) {
      light.radius = radius;
      frames.push(await renderFrame(app));
    }

    view3d.destroy({ children: true, geometry: true, material: true });
    return frames;
  } finally {
    app.destroy();
  }
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`light radius (${preference})`, () => {
    it('levels the hot spot off inside the radius, with no edge, and barely changes the light farther out', async () => {
      const [small, large] = await renderWall(preference, [0.1, 0.5]);
      const centre = SIZE / 2;
      const far = centre + 11;

      expect(redAt(large, centre, centre), 'a 0.5 radius dims the surface 0.3 from the light').toBeLessThan(
        redAt(small, centre, centre) - 20,
      );
      expect(redAt(small, far, centre), 'something lights the far pixel').toBeGreaterThan(10);
      expect(
        Math.abs(redAt(large, far, centre) - redAt(small, far, centre)),
        'a pixel about 1 from the light, twice the radius, barely changes',
      ).toBeLessThanOrEqual(2);

      const row = Array.from({ length: 13 }, (_, k) => redAt(large, centre + k, centre));
      const steps = row.slice(1).map((value, k) => row[k] - value);
      const largestSlopeJump = Math.max(...steps.slice(1).map((step, k) => step - steps[k]));
      expect(largestSlopeJump, `no edge where the radius ends; row ${row.join(' ')}`).toBeLessThanOrEqual(12);
    });
  });
}
