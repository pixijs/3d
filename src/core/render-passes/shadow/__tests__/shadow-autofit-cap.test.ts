import { getApp, isCI } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

/** Instance count comfortably over the shadow pass's auto-measure cap (256). */
const OVER_CAP = 300;

/**
 * Ground + auto-fit sun (`castShadow: true`, no shadow options). `instanceCount > 0` adds a
 * BatchedMesh3D cluster of shadow-casting cubes spanning roughly ±5 around the origin —
 * each instance counts toward the auto-measure cap individually.
 */
function buildScene(
  app: Application<Renderer>,
  instanceCount: number,
): { view3d: View3D; sun: DirectionalLight; batched: BatchedMesh3D | null } {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'medium' });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 80, height: 80 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  ground.position.set(0, -0.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);
  view3d.root.addChild(ground);

  let batched: BatchedMesh3D | null = null;
  if (instanceCount > 0) {
    const geometry = new CubeGeometry({ width: 0.4, height: 0.4, depth: 0.4 });
    const material = new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.5 });
    batched = new BatchedMesh3D({ size: instanceCount });
    const local = new Matrix4();
    const side = Math.ceil(Math.sqrt(instanceCount));
    for (let i = 0; i < instanceCount; i++) {
      const x = (i % side) - side / 2;
      const z = Math.floor(i / side) - side / 2;
      batched.setGeometryAt(i, geometry);
      batched.setMaterialAt(i, material);
      batched.setMatrixAt(i, local.makeTranslation(x * 0.5, 0, z * 0.5));
      batched.setItemActive(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
    }
    view3d.root.addChild(batched);
  }

  const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 5, castShadow: true });
  sun.rotation.set((-45 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
  view3d.root.addChild(sun);

  view3d.camera.fov = 50;
  view3d.camera.position.set(0, 8, 14);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  return { view3d, sun, batched };
}

// The auto-fit contract: under the cap the box re-measures every frame (content just works);
// over it the box freezes at the fitted bounds with a one-time warn, stops tracking scene
// changes, and fitShadowBounds() is the app's explicit one-shot re-measure. CI's GPU adapters
// are unreliable, so — like the scene suite — this runs locally.
for (const preference of ['webgpu', 'webgl'] as const) {
  describe.skipIf(isCI)(`shadow auto-fit caster cap (${preference})`, () => {
    it('under the cap, the box follows a moved caster with no app call', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-autofit-live-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const { view3d, sun } = buildScene(app, 0);
        const caster = new Mesh3D({
          geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
          material: new Material3D({ baseColor: 0xc06c4a, metallic: 0, roughness: 0.5 }),
          castShadow: true,
        });
        caster.position.set(-3, 0, 0);
        view3d.root.addChild(caster);

        app.render();
        app.render();
        expect(sun._autoShadowBoundsFrozen).toBe(false);
        expect(sun._autoShadowBounds!.max.x).toBeLessThan(0);

        caster.position.set(3, 0, 0);
        app.render();
        expect(sun._autoShadowBoundsFrozen).toBe(false);
        expect(sun._autoShadowBounds!.max.x).toBeGreaterThan(2);
      } finally {
        app.destroy();
      }
    });

    it('over the cap, the box freezes with a one-time warn; fitShadowBounds re-measures', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-autofit-frozen-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      const warnSpy = vi.spyOn(console, 'warn');
      try {
        const { view3d, sun } = buildScene(app, OVER_CAP);

        // Gather 1 holds a candidate; gather 2 (membership settled) freezes it.
        app.render();
        app.render();
        expect(sun._autoShadowBoundsFrozen).toBe(true);
        // The freeze notice is a page-global `warnOnce`: the first backend in this
        // file logs it, the second finds it already consumed.
        const expectLogged = preference === 'webgpu';
        expect(warnSpy.mock.calls.some((c) => c.join(' ').includes('auto-measure cap'))).toBe(expectLogged);
        const frozenMaxX = sun._autoShadowBounds!.max.x;

        // A caster added outside the frozen box does NOT grow it — frozen means frozen.
        const far = new Mesh3D({
          geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
          material: new Material3D({ baseColor: 0x4a6cc0, metallic: 0, roughness: 0.5 }),
          castShadow: true,
        });
        far.position.set(30, 0, 0);
        view3d.root.addChild(far);
        app.render();
        expect(sun._autoShadowBoundsFrozen).toBe(true);
        expect(sun._autoShadowBounds!.max.x).toBe(frozenMaxX);

        // The explicit one-shot re-measure picks the far caster up, then re-freezes.
        sun.fitShadowBounds();
        app.render();
        expect(sun._autoShadowBounds!.max.x).toBeGreaterThan(25);
        expect(sun._autoShadowBoundsFrozen).toBe(true);
      } finally {
        warnSpy.mockRestore();
        app.destroy();
      }
    });

    it('dropping back under the cap resumes live fitting', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-autofit-resume-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const { sun, batched } = buildScene(app, OVER_CAP);

        app.render();
        app.render();
        expect(sun._autoShadowBoundsFrozen).toBe(true);

        // Deactivate most instances → the caster count falls under the cap and the
        // pass re-fits live again (the box shrinks to the survivors).
        for (let i = 100; i < OVER_CAP; i++) batched!.setItemActive(i, 0);
        app.render();
        expect(sun._autoShadowBoundsFrozen).toBe(false);
      } finally {
        app.destroy();
      }
    });
  });
}
