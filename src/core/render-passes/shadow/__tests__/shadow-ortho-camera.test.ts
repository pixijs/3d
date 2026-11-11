import { getApp } from '@test-utils';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import type { CameraMode } from '~/scene/cameras/Camera3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 220;

interface ShadowReading {
  count: number;
  x: number;
  y: number;
}

async function readShadow(mode: CameraMode, cascades: 3 | undefined): Promise<ShadowReading> {
  const app = await getApp({
    id: `shadow-ortho-${mode}-${cascades}`,
    appOptions: { preference: 'webgl', width: SIZE, height: SIZE },
  });

  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'medium' });
  app.stage.addChild(view3d);

  const white = () => new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 1 });

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 400, height: 400 }),
    material: white(),
    castShadow: false,
  });
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const tower = new Mesh3D({
    geometry: new CubeGeometry({ width: 4, height: 26, depth: 4 }),
    material: white(),
    castShadow: true,
  });
  tower.position.set(0, 13, 0);
  view3d.root.addChild(tower);

  const sun = new DirectionalLight({
    color: 0xffffff,
    intensity: 4,
    castShadow: true,
    shadow: cascades === undefined ? {} : { cascades, maxDistance: 120 },
  });
  const elevation = (35 * Math.PI) / 180;
  const azimuth = (-55 * Math.PI) / 180;
  sun.position.set(
    Math.sin(azimuth) * Math.cos(elevation) * 200,
    Math.sin(elevation) * 200,
    Math.cos(azimuth) * Math.cos(elevation) * 200,
  );
  sun.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(sun);

  const camera = view3d.camera;
  camera.mode = mode;
  camera.fov = 45;
  camera.orthographicSize = 43;
  camera.near = 0.5;
  camera.far = 600;
  camera.position.set(0, 70, 70);
  camera.lookAt({ x: 12, y: 0, z: -6 });

  app.render();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  app.render();

  const px = app.renderer.extract.pixels(app.stage).pixels;

  let lit = 0;
  for (let p = 0; p < SIZE * SIZE; p++) lit = Math.max(lit, px[p << 2]);

  let count = 0;
  let sumX = 0;
  let sumY = 0;

  for (let p = 0; p < SIZE * SIZE; p++) {
    const i = p << 2;
    if (px[i + 3] > 0 && px[i] < lit * 0.7) {
      count++;
      sumX += p % SIZE;
      sumY += Math.floor(p / SIZE);
    }
  }

  app.destroy(true, true);

  return { count, x: count ? sumX / count / SIZE : 0, y: count ? sumY / count / SIZE : 0 };
}

describe('cascades under an orthographic camera, whose projection neither divides depth by distance nor widens with range', () => {
  it('matches what a perspective camera casts from the same framing', async () => {
    const ortho = await readShadow('orthographic', 3);
    const perspective = await readShadow('perspective', 3);

    const detail = `ortho ${JSON.stringify(ortho)} perspective ${JSON.stringify(perspective)}`;

    expect(ortho.count / perspective.count, detail).toBeGreaterThan(0.8);
    expect(ortho.count / perspective.count, detail).toBeLessThan(1.25);
    expect(Math.abs(ortho.x - perspective.x), detail).toBeLessThan(0.06);
    expect(Math.abs(ortho.y - perspective.y), detail).toBeLessThan(0.06);
  }, 60000);
});
