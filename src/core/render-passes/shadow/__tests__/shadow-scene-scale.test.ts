import { getApp } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 200;

const SCALES = [0.001, 0.01, 0.1, 1, 10, 100, 1000] as const;

async function shadowPixels(k: number, cascades: 1 | 2 | 3 | 4 | undefined): Promise<number> {
  const app = await getApp({ id: `shadow-scale-${k}`, appOptions: { preference: 'webgl', width: SIZE, height: SIZE } });

  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'medium' });
  app.stage.addChild(view3d);

  const white = () => new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 1 });

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 400 * k, height: 400 * k }),
    material: white(),
    castShadow: false,
  });
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const tower = new Mesh3D({
    geometry: new CubeGeometry({ width: 4 * k, height: 26 * k, depth: 4 * k }),
    material: white(),
    castShadow: true,
  });
  tower.position.set(0, 13 * k, 0);
  view3d.root.addChild(tower);

  const sun = new DirectionalLight({
    color: 0xffffff,
    intensity: 4,
    castShadow: true,
    shadow: cascades === undefined ? {} : { cascades, maxDistance: 120 * k },
  });
  const elevation = (35 * Math.PI) / 180;
  const azimuth = (-55 * Math.PI) / 180;
  sun.position.set(
    Math.sin(azimuth) * Math.cos(elevation) * 200 * k,
    Math.sin(elevation) * 200 * k,
    Math.cos(azimuth) * Math.cos(elevation) * 200 * k,
  );
  sun.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(sun);

  const camera = view3d.camera;
  camera.fov = 45;
  camera.near = 0.5 * k;
  camera.far = 600 * k;
  camera.position.set(0, 70 * k, 70 * k);
  camera.lookAt({ x: 12 * k, y: 0, z: -6 * k });

  app.render();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  app.render();

  const px = app.renderer.extract.pixels(app.stage).pixels;

  let lit = 0;
  for (let p = 0; p < SIZE * SIZE; p++) lit = Math.max(lit, px[p << 2]);

  let shadowed = 0;
  for (let p = 0; p < SIZE * SIZE; p++) {
    const i = p << 2;
    if (px[i + 3] > 0 && px[i] < lit * 0.7) shadowed++;
  }

  app.destroy(true, true);

  return shadowed;
}

describe('shadow placement across scene scales, where a depth range sized in fixed units would make the bias outgrow a small scene', () => {
  it.each([
    ['cascades', 3 as const],
    ['fixed box', undefined],
  ])(
    'holds the same shadow at every unit scale, since every length scales together (%s)',
    async (_label, cascades) => {
      const counts: number[] = [];
      for (const k of SCALES) counts.push(await shadowPixels(k, cascades));

      expect(Math.min(...counts)).toBeGreaterThan(0);
      for (const count of counts) {
        expect(count, `scales: ${SCALES.join(', ')} -> ${counts.join(', ')}`).toBe(counts[0]);
      }
    },
    120000,
  );
});
