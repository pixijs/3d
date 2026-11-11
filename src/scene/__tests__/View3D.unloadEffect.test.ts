import { expectCleanRender, getApp } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 160;

function tintedView(tint: TintEffect): View3D {
  const view3d = new View3D({
    width: SIZE,
    height: SIZE,
    environment: { skyColor: 0xffffff, groundColor: 0x223344 },
    passes: [tint],
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

function centre(frame: Uint8Array): number[] {
  const i = ((SIZE >> 1) * SIZE + (SIZE >> 1)) * 4;
  return [frame[i], frame[i + 1], frame[i + 2]];
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`view unload with a post effect (${preference})`, () => {
    it('draws the same tinted frame after unload() rebuilds the chain, with the same effect and its uniforms', async () => {
      const app = await getApp<Renderer>({
        id: `view-unload-effect-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x242c36 },
      });
      const tint = new TintEffect({ tint: 0x00ff00 });
      const view3d = tintedView(tint);
      try {
        app.stage.addChild(view3d);
        await expectCleanRender(app);
        await expectCleanRender(app);
        const before = pixels(app, view3d);
        const [r, g, b] = centre(before);
        expect([r < 8, b < 8, g > 32], 'the green tint multiplies the lit sphere').toEqual([true, true, true]);

        view3d.unload();

        await expectCleanRender(app);
        await expectCleanRender(app);
        expect(view3d.passes[0], 'the pass list is still the one assigned').toBe(tint);
        expect(tint.enabled).toBe(true);
        expect(differingPixels(before, pixels(app, view3d)), 'the rebuilt chain applies the same tint').toBe(0);

        tint.tint = 0xff0000;
        await expectCleanRender(app);
        const [r2, g2, b2] = centre(pixels(app, view3d));
        expect([g2 < 8, b2 < 8, r2 > 32], 'the effect’s uniforms still drive the rebuilt pass').toEqual([
          true,
          true,
          true,
        ]);
      } finally {
        view3d.destroy({ children: true });
        app.destroy(true);
      }
    });
  });
}
