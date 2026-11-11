import { captureWarnings, expectCleanRender, getApp } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 160;

function litView(): View3D {
  const view3d = new View3D({
    width: SIZE,
    height: SIZE,
    environment: { skyColor: 0xffffff, groundColor: 0x223344 },
  });
  view3d.camera.position.set(0, 1.4, 4);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.35 }));
  view3d.root.addChild(
    new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.9 }),
      material: new Material3D({ baseColor: 0x77aaff, roughness: 0.35, metallic: 0 }),
    }),
  );
  return view3d;
}

function pixels(app: Application<Renderer>, view3d: View3D): Uint8Array {
  return new Uint8Array(app.renderer.extract.pixels(view3d).pixels);
}

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
  describe(`one renderer per view (${preference})`, () => {
    function makeApp(id: string): Promise<Application<Renderer>> {
      return getApp<Renderer>({
        id: `${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x242c36 },
      });
    }

    it('throws at the first draw when a second live renderer draws the view', async () => {
      const app1 = await makeApp('one-renderer-second');
      const app2 = await makeApp('one-renderer-second-b');
      const view3d = litView();
      try {
        app1.stage.addChild(view3d);
        await expectCleanRender(app1);

        app2.stage.addChild(view3d);
        expect(() => app2.render(), 'the graph was built for the first renderer').toThrow(
          /a view renders with one renderer/,
        );
      } finally {
        view3d.destroy({ children: true });
        app2.destroy(true);
        app1.destroy(true);
      }
    });

    it('draws the same frame on a new renderer once the first one is destroyed', async () => {
      const app1 = await makeApp('one-renderer-again');
      const view3d = litView();
      app1.stage.addChild(view3d);
      await expectCleanRender(app1);
      await expectCleanRender(app1);
      const before = pixels(app1, view3d);

      const warnings = captureWarnings(() => app1.destroy(true));
      expect(
        warnings.filter((w) => w.includes('[BindGroup]')),
        "the view let go of the first renderer's data before its stores died",
      ).toEqual([]);
      expect(view3d.destroyed).toBe(false);

      const app2 = await makeApp('one-renderer-again-b');
      try {
        app2.stage.addChild(view3d);
        await expectCleanRender(app2);
        await expectCleanRender(app2);
        expect(differingPixels(before, pixels(app2, view3d)), 'the new renderer draws the same picture').toBe(0);
      } finally {
        view3d.destroy({ children: true });
        app2.destroy(true);
      }
    });
  });
}
