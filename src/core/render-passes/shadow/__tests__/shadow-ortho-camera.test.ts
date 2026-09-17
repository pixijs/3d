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

/**
 * One tower on open ground, framed by either camera mode, with the shadow placed either as a
 * fixed box or as cascades. Caster and ground are both white so only a real shadow reads dark.
 */
interface ShadowReading {
  /** Ground pixels dark enough to be in shadow */
  count: number;
  /** Where that shadow sits on screen, as a fraction of the frame */
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
  // Matched framing: at the subject's distance a 45-degree perspective view is 43 units
  // tall, so both modes see the same slab of world and their shadows are comparable.
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

  // Test files share a page, so an app left running keeps rendering into other files and
  // eventually draws through resources they have torn down. Each one goes as it is read.
  app.destroy(true, true);

  return { count, x: count ? sumX / count / SIZE : 0, y: count ? sumY / count / SIZE : 0 };
}

/**
 * Cascade placement reads the camera's projection to slice its frustum. Two of those reads only
 * hold for a perspective projection — the split-to-NDC conversion divides by the distance, which
 * is the `w` a perspective projection produces, and the slice's half-extents scale with the split
 * distance, which is a frustum widening with range. An orthographic camera does neither, and
 * cascaded shadows disappeared entirely under one.
 */
describe('cascades under an orthographic camera', () => {
  it('casts a shadow at all', async () => {
    expect((await readShadow('orthographic', 3)).count).toBeGreaterThan(0);
  }, 60000);

  it('matches what a perspective camera casts from the same framing', async () => {
    const ortho = await readShadow('orthographic', 3);
    const perspective = await readShadow('perspective', 3);

    // The remaining gap is the projections themselves — the tower's top is nearer the camera
    // under perspective, so its shadow leans differently. Measured at 7% of the area and 0.037
    // of the frame; the bounds leave room for that without admitting a misplaced cascade.
    const detail = `ortho ${JSON.stringify(ortho)} perspective ${JSON.stringify(perspective)}`;

    expect(ortho.count / perspective.count, detail).toBeGreaterThan(0.8);
    expect(ortho.count / perspective.count, detail).toBeLessThan(1.25);
    expect(Math.abs(ortho.x - perspective.x), detail).toBeLessThan(0.06);
    expect(Math.abs(ortho.y - perspective.y), detail).toBeLessThan(0.06);
  }, 60000);
});
