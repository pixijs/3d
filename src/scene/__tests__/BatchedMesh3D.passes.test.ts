import { expectCleanRender, getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { Geometry3D } from '~/geometry/Geometry3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

const DRAWN_AND_CASTING = RenderPassBit.OPAQUE | RenderPassBit.SHADOW;

const FOG = { type: 'linear', color: 0x8899aa, near: 4, far: 14 } as const;

function row(
  geometries: Geometry3D[],
  passes: number[],
  size = geometries.length,
): { view3d: View3D; batched: BatchedMesh3D } {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.camera.position.set(0, 5, 7);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

  const material = new FlatMaterial({ baseColor: 0xff8844 });
  const batched = new BatchedMesh3D({ size });
  const matrix = new Matrix4();
  geometries.forEach((geometry, i) => {
    batched.setGeometryAt(i, geometry);
    batched.setMaterialAt(i, material);
    batched.setMatrixAt(i, matrix.makeTranslation(2 * i - geometries.length + 1, 0, 0));
    batched.setPassesAt(i, passes[i]);
  });
  view3d.root.addChild(batched);

  return { view3d, batched };
}

function sunAndGround(): [DirectionalLight, Mesh3D] {
  const sun = new DirectionalLight({ intensity: 4, castShadow: true });
  sun.lookAt({ x: 0.5, y: -1, z: 0.4 });

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 12, height: 12 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  ground.position.set(0, -0.7, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);

  return [sun, ground];
}

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++;
  }
  return n;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`BatchedMesh3D.setPassesAt after the first render (${preference})`, () => {
    for (const [name, before] of [
      ['a drawn slot', RenderPassBit.OPAQUE],
      ['a slot in no pass', 0],
    ] as const) {
      it(`compiles the shadow shader for ${name} that joins the shadow pass`, async () => {
        const app = await getApp<Renderer>({
          id: `batched-passes-${before}-${preference}`,
          appOptions: { preference, width: 64, height: 64 },
        });

        try {
          const view3d = new View3D({ width: 64, height: 64 });
          view3d.camera.position.set(4, 6, 8);
          view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

          const sun = new DirectionalLight({ castShadow: true });
          sun.lookAt({ x: -0.4, y: -1, z: -0.3 });

          const batched = new BatchedMesh3D({ size: 1 });
          batched.setGeometryAt(0, new CubeGeometry());
          batched.setMaterialAt(0, new Material3D({ baseColor: 0xff8844 }));
          batched.setMatrixAt(0, new Matrix4());
          batched.setPassesAt(0, before);

          view3d.root.addChild(sun, batched);
          app.stage.addChild(view3d);
          app.render();

          const slot = batched.batch.items[0];
          expect(slot._passCache[RenderPassBit.SHADOW]).toBeUndefined();

          batched.setPassesAt(0, before | RenderPassBit.SHADOW);
          await expectCleanRender(app);

          expect(slot._passCache[RenderPassBit.SHADOW].shader).toBeDefined();
        } finally {
          app.destroy();
        }
      });
    }

    it('draws each slot that joins a pass with its own geometry', async () => {
      const app = await getApp<Renderer>({
        id: `batched-passes-late-join-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const cube = new CubeGeometry({ width: 1.4, height: 1.4, depth: 1.4 });
        const sphere = new SphereGeometry({ radius: 0.7 });
        const geometries = [cube, sphere, cube, sphere];

        const late = row(geometries, [RenderPassBit.OPAQUE, RenderPassBit.OPAQUE, 0, 0]);
        app.stage.addChild(late.view3d);
        app.render();

        late.batched.setPassesAt(2, RenderPassBit.OPAQUE);
        late.batched.setPassesAt(3, RenderPassBit.OPAQUE);
        const drawn = await renderFrame(app);

        late.view3d.destroy({ children: true });
        const fresh = row(
          geometries,
          geometries.map(() => RenderPassBit.OPAQUE),
        );
        app.stage.addChild(fresh.view3d);

        expect(differingPixels(drawn, await renderFrame(app))).toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('draws a slot and its shadow with the geometry it took while out of its passes, beside a slot that kept the old one', async () => {
      const app = await getApp<Renderer>({
        id: `batched-passes-rejoin-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const cube = new CubeGeometry({ width: 1.4, height: 1.4, depth: 1.4 });
        const sphere = new SphereGeometry({ radius: 0.7 });
        const passes = [DRAWN_AND_CASTING, DRAWN_AND_CASTING];

        const pooled = row([cube, cube], passes);
        pooled.view3d.root.addChild(...sunAndGround());
        app.stage.addChild(pooled.view3d);
        app.render();

        pooled.batched.setPassesAt(0, 0);
        pooled.batched.setGeometryAt(0, sphere);
        app.render();

        pooled.batched.setPassesAt(0, DRAWN_AND_CASTING);
        const drawn = await renderFrame(app);

        pooled.view3d.destroy({ children: true });
        const fresh = row([sphere, cube], passes);
        fresh.view3d.root.addChild(...sunAndGround());
        app.stage.addChild(fresh.view3d);

        expect(differingPixels(drawn, await renderFrame(app))).toBe(0);
      } finally {
        app.destroy();
      }
    });
  });

  describe(`BatchedMesh3D slots a batch leaves empty (${preference})`, () => {
    it('draws a batch with spare slots it never filled, before and after a fog change, the same as a batch without them', async () => {
      const app = await getApp<Renderer>({
        id: `batched-spare-fog-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const cube = new CubeGeometry({ width: 1.4, height: 1.4, depth: 1.4 });
        const sphere = new SphereGeometry({ radius: 0.7 });
        const passes = [RenderPassBit.OPAQUE, RenderPassBit.OPAQUE];

        const spare = row([cube, sphere], passes, 8);
        app.stage.addChild(spare.view3d);
        await renderFrame(app);

        spare.view3d.fog = FOG;
        const drawn = await renderFrame(app);

        spare.view3d.destroy({ children: true });
        const fresh = row([cube, sphere], passes);
        fresh.view3d.fog = FOG;
        app.stage.addChild(fresh.view3d);

        expect(differingPixels(drawn, await renderFrame(app))).toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('draws a spare slot filled later, whatever order its calls come in, the same as a batch built with it', async () => {
      const app = await getApp<Renderer>({
        id: `batched-spare-late-fill-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const cube = new CubeGeometry({ width: 1.4, height: 1.4, depth: 1.4 });
        const sphere = new SphereGeometry({ radius: 0.7 });
        const passes = [RenderPassBit.OPAQUE, RenderPassBit.OPAQUE];
        const front = new Matrix4().makeTranslation(0, 0, 1.6);

        const spare = row([cube, sphere], passes, 8);
        app.stage.addChild(spare.view3d);
        app.render();

        spare.batched.setPassesAt(2, RenderPassBit.OPAQUE);
        spare.batched.setMatrixAt(2, front);
        spare.batched.setMaterialAt(2, spare.batched.batch.items[0].material);
        spare.batched.setGeometryAt(2, cube);
        const drawn = await renderFrame(app);

        spare.view3d.destroy({ children: true });
        const fresh = row([cube, sphere], passes, 3);
        fresh.batched.setGeometryAt(2, cube);
        fresh.batched.setMaterialAt(2, fresh.batched.batch.items[0].material);
        fresh.batched.setMatrixAt(2, front);
        fresh.batched.setPassesAt(2, RenderPassBit.OPAQUE);
        app.stage.addChild(fresh.view3d);

        expect(differingPixels(drawn, await renderFrame(app))).toBe(0);
      } finally {
        app.destroy();
      }
    });

    it('keeps drawing after a slot is taken out of its passes, its geometry destroyed, and the fog changed', async () => {
      const app = await getApp<Renderer>({
        id: `batched-emptied-slot-fog-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const cube = new CubeGeometry({ width: 1.4, height: 1.4, depth: 1.4 });
        const sphere = new SphereGeometry({ radius: 0.7 });

        const emptied = row([sphere, cube], [RenderPassBit.OPAQUE, RenderPassBit.OPAQUE]);
        app.stage.addChild(emptied.view3d);
        app.render();

        emptied.batched.setPassesAt(0, 0);
        sphere.destroy();
        emptied.view3d.fog = FOG;
        const drawn = await renderFrame(app);

        emptied.view3d.destroy({ children: true });
        const fresh = row([new SphereGeometry({ radius: 0.7 }), cube], [0, RenderPassBit.OPAQUE]);
        fresh.view3d.fog = FOG;
        app.stage.addChild(fresh.view3d);

        expect(differingPixels(drawn, await renderFrame(app))).toBe(0);
      } finally {
        app.destroy();
      }
    });
  });
}
