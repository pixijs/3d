import { captureWarnings, getApp, isCI } from '@test-utils';
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

const OVER_CAP = 300;

function buildScene(
  app: Application<Renderer>,
  instanceCount: number,
): { view3d: View3D; sun: DirectionalLight; batched: BatchedMesh3D | null } {
  const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'medium' });
  app.stage.addChild(view3d);

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 400, height: 400 }),
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
      batched.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
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

const CASTER_RADIUS = Math.sqrt(3) / 2;

function addCaster(view3d: View3D, x: number): Mesh3D {
  const caster = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: new Material3D({ baseColor: 0xc06c4a, metallic: 0, roughness: 0.5 }),
    castShadow: true,
  });
  caster.position.set(x, 0, 0);
  view3d.root.addChild(caster);
  return caster;
}

function addBatchedCaster(view3d: View3D, x: number): BatchedMesh3D {
  const batched = new BatchedMesh3D({ size: 1 });
  batched.setGeometryAt(0, new CubeGeometry({ width: 1, height: 1, depth: 1 }));
  batched.setMaterialAt(0, new Material3D({ baseColor: 0xc06c4a, metallic: 0, roughness: 0.5 }));
  batched.setMatrixAt(0, new Matrix4().makeTranslation(x, 0, 0));
  batched.setPassesAt(0, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
  view3d.root.addChild(batched);
  return batched;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe.skipIf(isCI)(`shadow auto-fit caster cap (${preference})`, () => {
    it('a castShadow:false mesh attached first is outside the auto-fit box from the first frame', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-autofit-first-frame-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const { view3d, sun } = buildScene(app, 0);
        addCaster(view3d, -3);

        const warnings = captureWarnings(() => app.render());

        expect(sun._autoShadowBounds!.max.x).toBeLessThan(0);
        expect(sun._autoShadowBounds!.min.x).toBeGreaterThan(-4);
        expect(warnings.some((w) => w.includes('spans a large scene'))).toBe(false);
      } finally {
        app.destroy();
      }
    });

    it('a caster attached later is inside the box on the frame it first renders', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-autofit-add-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const { view3d, sun } = buildScene(app, 0);
        addCaster(view3d, -3);
        app.render();

        addCaster(view3d, 30);
        app.render();

        expect(sun._autoShadowBounds!.max.x).toBeCloseTo(30 + CASTER_RADIUS, 1);
      } finally {
        app.destroy();
      }
    });

    it('a removed caster leaves the box on the frame after removal', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-autofit-remove-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const { view3d, sun } = buildScene(app, 0);
        const casterA = addCaster(view3d, -3);
        addCaster(view3d, 30);
        app.render();

        view3d.root.removeChild(casterA);
        app.render();

        expect(sun._autoShadowBounds!.min.x).toBeCloseTo(30 - CASTER_RADIUS, 1);
      } finally {
        app.destroy();
      }
    });

    it('a slot hidden with setVisibleAt leaves the box on the next frame, and comes back when shown', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-autofit-hidden-slot-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const { view3d, sun } = buildScene(app, 0);
        addCaster(view3d, -3);
        const batched = addBatchedCaster(view3d, 30);
        app.render();
        expect(sun._autoShadowBounds!.max.x).toBeCloseTo(30 + CASTER_RADIUS, 1);

        batched.setVisibleAt(0, false);
        app.render();
        expect(sun._autoShadowBounds!.max.x, 'only the caster at x = -3 is left').toBeLessThan(0);

        batched.setVisibleAt(0, true);
        app.render();
        expect(sun._autoShadowBounds!.max.x).toBeCloseTo(30 + CASTER_RADIUS, 1);
      } finally {
        app.destroy();
      }
    });

    it('a hidden mesh leaves the box on the next frame', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-autofit-hidden-mesh-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const { view3d, sun } = buildScene(app, 0);
        addCaster(view3d, -3);
        const far = addCaster(view3d, 30);
        app.render();

        far.visible = false;
        app.render();

        expect(sun._autoShadowBounds!.max.x).toBeLessThan(0);
      } finally {
        app.destroy();
      }
    });

    it('under the cap, the box follows a moved caster with no app call', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-autofit-live-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });
      try {
        const { view3d, sun } = buildScene(app, 0);
        const caster = addCaster(view3d, -3);

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

        app.render();
        expect(sun._autoShadowBoundsFrozen, 'the first over-cap gather fits the box and freezes it').toBe(true);
        expect(
          sun._autoShadowBounds!.max.x,
          "the grid's last column sits at x = 4, so the box spans the whole batch, not one slot",
        ).toBeGreaterThan(4);
        const expectLogged = preference === 'webgpu';
        expect(warnSpy.mock.calls.some((c) => c.join(' ').includes('auto-measure cap'))).toBe(expectLogged);
        const frozenMaxX = sun._autoShadowBounds!.max.x;

        addCaster(view3d, 30);
        app.render();
        expect(sun._autoShadowBoundsFrozen).toBe(true);
        expect(sun._autoShadowBounds!.max.x, 'a caster added outside the frozen box does not grow it').toBe(frozenMaxX);

        sun.fitShadowBounds();
        app.render();
        expect(sun._autoShadowBounds!.max.x, 'the one-shot re-measure picks the far caster up').toBeGreaterThan(25);
        expect(sun._autoShadowBoundsFrozen, 'then freezes again').toBe(true);
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
        expect(sun._autoShadowBoundsFrozen).toBe(true);

        for (let i = 100; i < OVER_CAP; i++) batched!.setPassesAt(i, 0);
        app.render();
        expect(sun._autoShadowBoundsFrozen).toBe(false);
        expect(
          sun._autoShadowBounds!.max.z,
          'instances 0..99 fill grid rows 0 to 5, whose z ends at -2, so the box shrinks the frame the rest leave',
        ).toBeLessThan(0);
      } finally {
        app.destroy();
      }
    });
  });
}
