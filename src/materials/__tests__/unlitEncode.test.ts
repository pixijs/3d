import { getApp, readCanvasPixels } from '@test-utils';
import { Graphics, Sprite } from 'pixi.js';
import type { Application, Container, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { PortalMaterial } from '~/extras/materials/portal/PortalMaterial';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';
import type { View3DOptions } from '~/scene/View3D';

import { halfLifeParticle, oneParticle, plane, solidTexture } from './unlitFixtures';

const SIZE = 32;

type Rgb = [number, number, number];

const rgb = (color: number): Rgb => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];

const fill = (color: number) => (stage: Container) => {
  stage.addChild(new Graphics().rect(0, 0, SIZE, SIZE).fill(color));
};

const tintedSprite = (texel: number, tint: number) => (stage: Container) => {
  stage.addChild(new Sprite({ texture: solidTexture(texel), tint, width: SIZE, height: SIZE }));
};

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`unlit output is encoded for display (${preference})`, () => {
    async function sideBySide(
      id: string,
      pixi: (stage: Container) => void,
      build: (view3d: View3D) => void,
      viewOptions: Partial<View3DOptions> = {},
    ): Promise<{ pixi: Rgb; view: Rgb }> {
      const app: Application<Renderer> = await getApp({
        id: `unlit-encode-${id}-${preference}`,
        appOptions: { preference, width: SIZE * 2, height: SIZE, resolution: 1, backgroundColor: 0, autoStart: false },
      });
      const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none', ...viewOptions });

      try {
        pixi(app.stage);
        view3d.position.set(SIZE, 0);
        view3d.camera.position.set(0, 0, 2.5);
        app.stage.addChild(view3d);
        build(view3d);

        app.render();
        const row = readCanvasPixels(app.canvas, 0, SIZE / 2, SIZE * 2, 1);
        const at = (x: number): Rgb => [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]];

        return { pixi: at(SIZE / 2), view: at(SIZE + SIZE / 2) };
      } finally {
        view3d.destroy({ children: true, geometry: true, material: true, texture: true, textureSource: true });
        app.destroy(true);
      }
    }

    const matches: [string, (stage: Container) => void, (view3d: View3D) => void][] = [
      [
        'FlatMaterial baseColor',
        fill(0x808080),
        (v) => v.root.addChild(plane(new FlatMaterial({ baseColor: 0x808080 }))),
      ],
      [
        'a dark FlatMaterial baseColor',
        fill(0x0a141e),
        (v) => v.root.addChild(plane(new FlatMaterial({ baseColor: 0x0a141e }))),
      ],
      [
        'FlatMaterial texture × baseColor',
        tintedSprite(0x804020, 0x808080),
        (v) =>
          v.root.addChild(plane(new FlatMaterial({ baseColorTexture: solidTexture(0x804020), baseColor: 0x808080 }))),
      ],
      [
        'Sprite3D texture × tint',
        tintedSprite(0x804020, 0x808080),
        (v) => v.root.addChild(new Sprite3D({ texture: solidTexture(0x804020), tint: 0x808080, pixelSize: 5 })),
      ],
      [
        'PortalMaterial feed × baseColor',
        tintedSprite(0x804020, 0x808080),
        (v) => v.root.addChild(plane(new PortalMaterial({ texture: solidTexture(0x804020), baseColor: 0x808080 }))),
      ],
      ['a particle tint', fill(0x336699), (v) => v.root.addChild(oneParticle(0x336699))],
      [
        'a particle texture × tint',
        tintedSprite(0x804020, 0x808080),
        (v) => v.root.addChild(oneParticle(0x808080, solidTexture(0x804020))),
      ],
      [
        'a colour ramp at half life, blending the authored colours evenly',
        fill(0x788282),
        (v) => v.root.addChild(halfLifeParticle(0xc86428, 0x28a0dc)),
      ],
      [
        'a FlatMaterial with linear vertex colours',
        fill(0x808080),
        (v) =>
          v.root.addChild(
            new Mesh3D({
              geometry: new PlaneGeometry({
                width: 20,
                height: 20,
                colors: new Float32Array(16).map((_, i) => (i % 4 === 3 ? 1 : 0.2195)),
              }),
              material: new FlatMaterial({ vertexColors: true }),
              castShadow: false,
            }),
          ),
      ],
    ];

    for (const [label, pixi, build] of matches) {
      it(`${label} matches pixi 2D`, async () => {
        const { pixi: expected, view } = await sideBySide(label, pixi, build);

        expect(view).toEqual(expected);
      });
    }

    it('fades a fully fogged unlit surface to the fog colour as authored', async () => {
      const { view } = await sideBySide(
        'fog',
        () => undefined,
        (v) => v.root.addChild(plane(new FlatMaterial({ baseColor: 0xd0402a }))),
        { toneMapping: 'none', fog: { type: 'linear', color: 0x808080, near: 0, far: 0.1 } },
      );

      expect(view).toEqual(rgb(0x808080));
    });

    it("leaves an unlit colour linear under toneMapping: 'custom'", async () => {
      const { view } = await sideBySide(
        'custom',
        () => undefined,
        (v) => v.root.addChild(plane(new FlatMaterial({ baseColor: 0x808080 }))),
        { toneMapping: 'custom' },
      );
      const linear = Math.round(Math.pow(128 / 255, 2.2) * 255);

      expect(view).toEqual([linear, linear, linear]);
    });

    it("puts an unlit colour through the view's curve, where a background of the same colour lands", async () => {
      const aces = { toneMapping: 'aces' } as const;
      const flat = await sideBySide(
        'aces-flat',
        () => undefined,
        (v) => v.root.addChild(plane(new FlatMaterial({ baseColor: 0x808080 }))),
        aces,
      );
      const sky = await sideBySide(
        'aces-sky',
        () => undefined,
        (v) => {
          const offScreen = plane(new FlatMaterial());
          offScreen.position.x = 100;
          v.root.addChild(offScreen);
        },
        { ...aces, background: 0x808080 },
      );

      expect(flat.view).toEqual(sky.view);
      expect(flat.view).not.toEqual(rgb(0x808080));
    });
  });
}
