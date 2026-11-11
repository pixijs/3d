import { getApp, readCanvasPixels } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PortalMaterial } from '~/extras/materials/portal/PortalMaterial';
import type { ColorSpace } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import type { Mesh3D } from '~/scene/Mesh3D';
import { Sprite3D } from '~/scene/Sprite3D';
import { View3D } from '~/scene/View3D';
import type { ToneMapping } from '~/scene/View3D';

import { halfLifeParticle, oneParticle, plane, solidTexture } from './unlitFixtures';

const SIZE = 32;

const UNREACHED_FOG = { type: 'linear', color: 0xff00ff, near: 1000, far: 2000 } as const;

const writesFinalColorBit: ShaderBit = {
  name: 'unlitDisplayPathWritesFinalColor',
  gpu: { fragment: { lighting: 'finalColor = vec3<f32>(1.0, 0.0, 0.0);' } },
  gl: { fragment: { lighting: 'finalColor = vec3(1.0, 0.0, 0.0);' } },
};

const addsColoursBit: ShaderBit = {
  name: 'unlitDisplayPathAddsColours',
  gpu: { fragment: { material: 'albedo = decodeColor(vec3<f32>(0.2)) + decodeColor(vec3<f32>(0.2));' } },
  gl: { fragment: { material: 'albedo = decodeColor(vec3(0.2)) + decodeColor(vec3(0.2));' } },
};

const cases: [string, () => Mesh3D][] = [
  ['FlatMaterial colour', () => plane(new FlatMaterial({ baseColor: 0x0a5ac8 }))],
  ['FlatMaterial float colour', () => plane(new FlatMaterial({ baseColor: [0.371, 0.613, 0.129] }))],
  [
    'FlatMaterial texture × colour, blended',
    () =>
      plane(
        new FlatMaterial({ baseColorTexture: solidTexture(0x804020, 160), baseColor: 0xc0c0ff, alphaMode: 'blend' }),
      ),
  ],
  [
    'FlatMaterial with alpha and colour set after construction',
    () => {
      const material = new FlatMaterial({ alphaMode: 'blend' });
      material.baseColor = 0x40c080;
      material.alpha = 0.6;
      return plane(material);
    },
  ],
  [
    'FlatMaterial with an extra bit writing finalColor',
    () => plane(new FlatMaterial({ baseColor: 0x808080, extraBits: [writesFinalColorBit] })),
  ],
  ['Sprite3D texture × tint', () => new Sprite3D({ texture: solidTexture(0x30c070), tint: 0xffa040, pixelSize: 5 })],
  ['particle texture × tint', () => oneParticle(0x336699, solidTexture(0xe0c0a0))],
  ['particle colour ramp', () => halfLifeParticle(0xc86428, 0x28a0dc)],
  [
    'PortalMaterial feed × tint',
    () => plane(new PortalMaterial({ texture: solidTexture(0x804020), baseColor: 0xa0a0ff })),
  ],
];

async function drawBothPaths(
  preference: 'webgl' | 'webgpu',
  exposure: number,
  build: () => Mesh3D,
  toneMapping: ToneMapping = 'none',
): Promise<{ fast: number[]; exact: number[]; colorSpace: ColorSpace }> {
  const app = await getApp<Renderer>({
    id: `unlit-display-path-${preference}`,
    appOptions: { preference, width: SIZE * 2, height: SIZE, resolution: 1, backgroundColor: 0, autoStart: false },
  });
  const fast = new View3D({ width: SIZE, height: SIZE, exposure, toneMapping });
  const exact = new View3D({ width: SIZE, height: SIZE, exposure, toneMapping, fog: UNREACHED_FOG });

  try {
    const fastMesh = build();

    fast.root.addChild(fastMesh);
    exact.root.addChild(build());
    exact.position.set(SIZE, 0);
    for (const view of [fast, exact]) {
      view.camera.position.set(0, 0, 2.5);
      app.stage.addChild(view);
    }

    app.render();
    const row = readCanvasPixels(app.canvas, 0, SIZE / 2, SIZE * 2, 1);
    const at = (x: number): number[] => Array.from(row.subarray(x * 4, x * 4 + 3));

    return { fast: at(SIZE / 2), exact: at(SIZE + SIZE / 2), colorSpace: fastMesh.material.colorSpace };
  } finally {
    for (const view of [fast, exact]) {
      view.destroy({ children: true, geometry: true, material: true, texture: true, textureSource: true });
    }
    app.destroy(true);
  }
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`colorSpace 'display' materials without fog draw in display space (${preference})`, () => {
    for (const exposure of [1, 2.5]) {
      for (const [label, build] of cases) {
        it(`${label} at exposure ${exposure} lands on the linear path's bytes`, async () => {
          const { fast, exact, colorSpace } = await drawBothPaths(preference, exposure, build);

          expect(colorSpace).toBe('display');
          expect(fast).toEqual(exact);
        });
      }
    }

    it('adds colours in display space without fog and in linear light with it', async () => {
      const { fast, exact } = await drawBothPaths(preference, 1, () =>
        plane(new FlatMaterial({ extraBits: [addsColoursBit] })),
      );

      expect(fast).toEqual([102, 102, 102]);
      expect(exact).toEqual([70, 70, 70]);
    });
  });
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`display space needs a shader that ends in the encode alone (${preference})`, () => {
    it("adds a flat material's colours in linear light under 'aces', with or without fog", async () => {
      const { fast, exact } = await drawBothPaths(
        preference,
        1,
        () => plane(new FlatMaterial({ extraBits: [addsColoursBit] })),
        'aces',
      );

      expect(fast).toEqual(exact);
    });

    it("draws a portal's feed as authored under 'aces', since the view curved it already", async () => {
      const { fast, exact } = await drawBothPaths(
        preference,
        1,
        () => plane(new PortalMaterial({ texture: solidTexture(0x804020) })),
        'aces',
      );

      expect(fast).toEqual([0x80, 0x40, 0x20]);
      expect(exact).toEqual(fast);
    });
  });
}
