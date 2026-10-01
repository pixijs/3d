import { getApp, isCI } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 256;

/**
 * A ground + cubes, shadowed by up to two directional lights aimed from clearly different angles (so
 * their shadows are easy to tell apart). `sunA` is added first (the removable one, list index 0),
 * `sunB` second. Returns the view and the `sunA` handle so a test can detach it mid-run.
 */
function buildScene(
  app: Application<Renderer>,
  includeSunA: boolean,
  includeSunB: boolean,
): { view3d: View3D; sunA: DirectionalLight | null } {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'medium', cull: 'gpu' });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 40, height: 40 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  ground.position.set(0, -0.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  const colors = [0x4a7c59, 0xc06c4a, 0x4a6cc0, 0xc0a84a];
  for (let i = 0; i < colors.length; i++) {
    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({ baseColor: colors[i], metallic: 0, roughness: 0.5 }),
      castShadow: true,
    });
    cube.position.set(i * 2 - 3, 0, 0);
    view3d.root.addChild(cube);
  }

  let sunA: DirectionalLight | null = null;
  if (includeSunA) {
    sunA = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 4,
      castShadow: true,
      shadow: { cascades: 2, maxDistance: 30 },
    });
    sunA.rotation.set((-55 * Math.PI) / 180, (55 * Math.PI) / 180, 0);
    view3d.root.addChild(sunA);
  }

  if (includeSunB) {
    const sunB = new DirectionalLight({
      color: 0xe0ecff,
      intensity: 4,
      castShadow: true,
      shadow: { cascades: 2, maxDistance: 30 },
    });
    sunB.rotation.set((-35 * Math.PI) / 180, (-50 * Math.PI) / 180, 0);
    view3d.root.addChild(sunB);
  }

  view3d.camera.fov = 50;
  view3d.camera.position.set(4, 6, 10);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  return { view3d, sunA };
}

/** Builds a scene, renders one more frame so every capture has the same frame history, and reads its pixels */
async function pixelsFor(
  preference: 'webgl' | 'webgpu',
  id: string,
  build: (app: Application<Renderer>) => View3D,
): Promise<Uint8Array> {
  const app = await getApp<Renderer>({
    id: `${id}-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE },
  });
  try {
    const view3d = build(app);
    app.render();
    return new Uint8Array(app.renderer.extract.pixels(view3d).pixels);
  } finally {
    app.destroy();
  }
}

/** Count pixels whose colour differs by more than `tol` on any channel. */
function differingPixels(a: Uint8Array, b: Uint8Array, tol = 8): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > tol || Math.abs(a[i + 1] - b[i + 1]) > tol || Math.abs(a[i + 2] - b[i + 2]) > tol) {
      n++;
    }
  }
  return n;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe.skipIf(isCI)(`shadow light removal (${preference})`, () => {
    it('after removing the first of two shadow lights, the survivor renders its own shadow, not one keyed to its old list index', async () => {
      const afterRemoval = await pixelsFor(preference, 'shadow-rm-2then1', (app) => {
        const { view3d, sunA } = buildScene(app, true, true);
        app.render();
        view3d.root.removeChild(sunA!);
        app.render();
        return view3d;
      });

      const justB = await pixelsFor(preference, 'shadow-rm-b', (app) => buildScene(app, false, true).view3d);
      const justA = await pixelsFor(preference, 'shadow-rm-a', (app) => buildScene(app, true, false).view3d);

      const budget = Math.round((afterRemoval.length / 4) * 0.01);

      expect(differingPixels(afterRemoval, justB), 'matches a scene built with only sunB').toBeLessThan(budget);
      expect(
        differingPixels(afterRemoval, justA),
        "differs from sunA's shadow, which also shows the two lights' shadows differ",
      ).toBeGreaterThan(budget);
    });
  });
}
