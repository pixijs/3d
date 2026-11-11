import { getApp, renderFrame } from '@test-utils';
import { RenderTexture, Sprite } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';

import { ExtractPass } from '~/extras/scene-outputs/ExtractPass';
import { normalOutput } from '~/extras/scene-outputs/normalOutput';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 16;

function centre(app: Application<Renderer>, capture: ExtractPass): number[] {
  const sprite = new Sprite(capture.texture);
  const readable = RenderTexture.create({ width: capture.texture.width, height: capture.texture.height });
  app.renderer.render({ container: sprite, target: readable });
  const { pixels, width, height } = app.renderer.extract.pixels({ target: readable });
  readable.destroy(true);
  sprite.destroy();
  const i = ((height >> 1) * width + (width >> 1)) * 4;
  return Array.from(pixels.slice(i, i + 4));
}

function packed(x: number, y: number, z: number): number[] {
  return [x, y, z].map((c) => Math.round((c * 0.5 + 0.5) * 255)).concat(255);
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`normal output (${preference})`, () => {
    let app: Application<Renderer>;
    let view3d: View3D;
    let capture: ExtractPass;

    async function setup(id: string): Promise<void> {
      app = await getApp<Renderer>({
        id: `normal-output-${id}-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x000000, autoStart: false },
      });
      expect(app.renderer.name).toBe(preference);
      capture = new ExtractPass({ output: normalOutput });
      view3d = new View3D({ width: SIZE, height: SIZE, passes: [capture] });
      app.stage.addChild(view3d);
      view3d.camera.position.set(0, 0, 5);
    }

    afterEach(() => {
      view3d?.destroy(true);
      capture?.destroy();
      app?.destroy();
    });

    it('stores a surface facing the camera as +z', async () => {
      await setup('facing');
      view3d.root.addChild(
        new Mesh3D({ geometry: new PlaneGeometry({ width: 40, height: 40 }), material: new Material3D() }),
      );

      await renderFrame(app);
      for (const [got, want] of centre(app, capture).map((c, i) => [c, packed(0, 0, 1)[i]])) {
        expect(Math.abs(got - want)).toBeLessThanOrEqual(2);
      }
    });

    it('stores a surface tilted to face up as +y, drawn to the canvas or into a texture', async () => {
      await setup('tilted');
      const wall = new Mesh3D({ geometry: new PlaneGeometry({ width: 40, height: 40 }), material: new Material3D() });
      wall.rotation.set(-Math.PI / 4, 0, 0);
      view3d.root.addChild(wall);
      const want = packed(0, Math.SQRT1_2, Math.SQRT1_2);

      await renderFrame(app);
      const onCanvas = centre(app, capture);

      const rt = RenderTexture.create({ width: SIZE, height: SIZE });
      app.renderer.render({ container: view3d, target: rt });
      const intoTexture = centre(app, capture);
      rt.destroy(true);

      for (const [label, got] of [
        ['canvas', onCanvas],
        ['texture', intoTexture],
      ] as const) {
        for (let i = 0; i < 4; i++) {
          expect(
            Math.abs(got[i] - want[i]),
            `${label} channel ${i}: ${got.join(', ')} against ${want.join(', ')}`,
          ).toBeLessThanOrEqual(2);
        }
      }
    });

    it("stores a glass surface's own normal, not the one behind it", async () => {
      await setup('glass');
      const wall = new Mesh3D({ geometry: new PlaneGeometry({ width: 40, height: 40 }), material: new Material3D() });
      wall.position.z = -3;
      const glass = new Mesh3D({
        geometry: new PlaneGeometry({ width: 40, height: 40 }),
        material: new Material3D({ transmission: { factor: 1 } }),
      });
      glass.rotation.set(-Math.PI / 4, 0, 0);
      view3d.root.addChild(wall, glass);
      const want = packed(0, Math.SQRT1_2, Math.SQRT1_2);

      await renderFrame(app);
      const got = centre(app, capture);
      for (let i = 0; i < 4; i++) {
        expect(
          Math.abs(got[i] - want[i]),
          `channel ${i}: ${got.join(', ')} against ${want.join(', ')}`,
        ).toBeLessThanOrEqual(2);
      }
    });

    it('leaves pixels no surface drew at zero', async () => {
      await setup('empty');

      await renderFrame(app);
      expect(centre(app, capture)).toEqual([0, 0, 0, 0]);
    });
  });
}
