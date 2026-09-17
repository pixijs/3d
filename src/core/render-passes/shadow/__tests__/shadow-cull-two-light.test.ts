import { getApp, isCI } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import type { CullMode } from '~/scene/View3D';
import { View3D } from '~/scene/View3D';

const SIZE = 256;

/**
 * Two directional lights, both casting from clearly different angles (so their cull volumes genuinely
 * differ), over a row of cubes that sit inside *both* lights' volumes. A correct per-view caster cull
 * keeps every cube for every shadow map that needs it, so the shadows are identical to an unculled
 * render.
 *
 * This exercises the per-light cull on both backends: every casting light culls against its own light
 * frustum — WebGPU into its own survivor + args buffers, WebGL via its per-light compacting uploads.
 */
function buildScene(app: Application<Renderer>, cull: CullMode): View3D {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'medium', cull });
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

  const sunA = new DirectionalLight({
    color: 0xfff4e0,
    intensity: 4,
    castShadow: true,
    shadow: { cascades: 2, maxDistance: 30 },
  });
  sunA.rotation.set((-50 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
  view3d.root.addChild(sunA);

  const sunB = new DirectionalLight({
    color: 0xe0ecff,
    intensity: 3,
    castShadow: true,
    shadow: { cascades: 2, maxDistance: 30 },
  });
  sunB.rotation.set((-40 * Math.PI) / 180, (-45 * Math.PI) / 180, 0);
  view3d.root.addChild(sunB);

  view3d.camera.fov = 50;
  view3d.camera.position.set(4, 6, 10);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  return view3d;
}

/** Render the two-light scene on a backend at a cull mode and read the rendered pixels back. */
async function renderPixels(preference: 'webgl' | 'webgpu', cull: CullMode): Promise<Uint8Array> {
  const app = await getApp<Renderer>({
    id: `2light-${preference}-${cull}`,
    appOptions: { preference, width: SIZE, height: SIZE },
  });
  try {
    const view3d = buildScene(app, cull);
    app.render();
    // Copy the pixels off the returned view before the app (and its GPU buffers) are destroyed.
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

// Both backends run the per-light shadow cull. CI's GPU adapters are unreliable, so — like the scene
// suite — this runs locally. It's a *relative* comparison of three renders on one adapter, not a
// golden match. ('gpu' degrades to 'cpu' on WebGL, so there it asserts the degrade path.)
for (const preference of ['webgpu', 'webgl'] as const) {
  describe.skipIf(isCI)(`two-light shadow-caster cull (${preference})`, () => {
    it('cull keeps every shadowing caster: cull-on matches cull-off, and cpu matches gpu', async () => {
      const off = await renderPixels(preference, 'off');
      const cpu = await renderPixels(preference, 'cpu');
      const gpu = await renderPixels(preference, 'gpu');

      // A correct shadow cull is invisible — a caster outside a light's frustum casts no shadow into the
      // visible scene either way, and every caster here is inside both. So the only way these diverge is a
      // bug that drops (or mis-binds) a caster that *should* shadow. GPU shading jitter only, hence a small
      // budget rather than exact equality; a dropped shadow would change far more than this.
      const budget = Math.round((off.length / 4) * 0.005);

      expect(differingPixels(off, cpu)).toBeLessThan(budget); // cull-on (cpu) == cull-off
      expect(differingPixels(off, gpu)).toBeLessThan(budget); // cull-on (gpu) == cull-off  → transitively cpu == gpu
    });
  });
}
