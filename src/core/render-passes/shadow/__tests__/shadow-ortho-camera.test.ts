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

/** How much of the ground reads as shadow, and where */
interface ShadowReading {
  /** Ground pixels dark enough to be in shadow */
  count: number;
  /** Where that shadow sits on screen, as a fraction of the frame */
  x: number;
  y: number;
}

/**
 * Renders one tower on open ground, framed by either camera mode, with the shadow placed either as
 * a fixed box or as cascades, and reads the shadow back
 *
 * Caster and ground are both white so only a real shadow reads dark. The orthographic size of 43
 * is what the 45° perspective view spans at the subject's distance, so both modes see the same slab
 * of world and their shadows compare. The app is destroyed as soon
 * as it is read: test files share a page, so an app left running keeps rendering into other files
 * and eventually draws through resources they have torn down.
 */
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
  it('casts a shadow at all', async () => {
    expect((await readShadow('orthographic', 3)).count).toBeGreaterThan(0);
  }, 60000);

  it('matches what a perspective camera casts from the same framing', async () => {
    const ortho = await readShadow('orthographic', 3);
    const perspective = await readShadow('perspective', 3);

    /**
     * The bounds leave room for the projections' own difference, measured at 7% of the area and 0.037
     * of the frame: the tower's top is nearer the camera under perspective, so its shadow leans
     * differently. A misplaced cascade lands well outside them.
     */
    const detail = `ortho ${JSON.stringify(ortho)} perspective ${JSON.stringify(perspective)}`;

    expect(ortho.count / perspective.count, detail).toBeGreaterThan(0.8);
    expect(ortho.count / perspective.count, detail).toBeLessThan(1.25);
    expect(Math.abs(ortho.x - perspective.x), detail).toBeLessThan(0.06);
    expect(Math.abs(ortho.y - perspective.y), detail).toBeLessThan(0.06);
  }, 60000);
});
