import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import type { AlphaMode } from '~/materials/BaseMaterial3D';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 32;
const RED = 0xff0000;
const BACKENDS = ['webgl', 'webgpu'] as const;

const lateHalfAlphaBit: ShaderBit = {
  name: 'testLateHalfAlpha',
  gpu: { fragment: { end: 'alpha *= 0.5;' } },
  gl: { fragment: { end: 'alpha *= 0.5;' } },
};

const rawHalfAlphaRedBit: ShaderBit = {
  name: 'testRawHalfAlphaRed',
  gpu: { fragment: { material: 'albedo = vec3<f32>(1.0, 0.0, 0.0); alpha = 0.5;' } },
  gl: { fragment: { material: 'albedo = vec3(1.0, 0.0, 0.0); alpha = 0.5;' } },
};

const HALF_ALPHA_MATERIALS: [string, (halfAlphaRed: Texture) => BaseMaterial3D][] = [
  ["a texture's alpha", (halfAlphaRed) => new FlatMaterial({ baseColorTexture: halfAlphaRed })],
  ['the alpha option', () => new FlatMaterial({ baseColor: RED, alpha: 0.5 })],
  ['alpha a bit writes in the end slot', () => new FlatMaterial({ baseColor: RED, extraBits: [lateHalfAlphaBit] })],
  [
    'the alpha option on a PhongMaterial',
    () => new PhongMaterial({ baseColor: 0, alpha: 0.5, emissive: { color: RED } }),
  ],
  [
    'alpha a raw descriptor writes',
    () => new BaseMaterial3D({ descriptor: { bitsGpu: [rawHalfAlphaRedBit], bitsGl: [rawHalfAlphaRedBit] } }),
  ],
];

function halfAlphaRedTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const context = canvas.getContext('2d')!;
  context.fillStyle = 'rgba(255, 0, 0, 0.5)';
  context.fillRect(0, 0, 4, 4);

  return Texture.from({ resource: canvas, label: 'alpha-mode-opaque-red', alphaMode: 'premultiply-alpha-on-upload' });
}

async function withPlane<T extends BaseMaterial3D>(
  preference: (typeof BACKENDS)[number],
  create: (halfAlphaRed: Texture) => T,
  check: (centrePixel: () => Promise<number[]>, material: T) => Promise<void>,
): Promise<void> {
  const app = await getApp<Renderer>({
    id: `alpha-mode-opaque-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x00ff00 },
  });
  const texture = halfAlphaRedTexture();
  try {
    const material = create(texture);
    const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });
    app.stage.addChild(view3d);
    view3d.root.addChild(new Mesh3D({ geometry: new PlaneGeometry({ width: 4, height: 4 }), material }));
    view3d.camera.position.set(0, 0, 2);

    const centre = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
    await check(async () => Array.from((await renderFrame(app)).subarray(centre, centre + 4)), material);
  } finally {
    app.destroy(true, { children: true });
    texture.destroy(true);
  }
}

function expectOpaqueRed([r, g, b, a]: number[]): void {
  expect(r).toBeGreaterThanOrEqual(253);
  expect(g).toBeLessThanOrEqual(2);
  expect(b).toBeLessThanOrEqual(2);
  expect(a).toBe(255);
}

describe("alphaMode 'opaque'", () => {
  it.each(
    BACKENDS.flatMap((preference) => HALF_ALPHA_MATERIALS.map(([what, create]) => [what, preference, create] as const)),
  )('ignores %s on %s', async (_, preference, create) => {
    await withPlane(preference, create, async (centrePixel) => {
      expectOpaqueRed(await centrePixel());
    });
  });

  it.each(BACKENDS)('follows an alphaMode switched after the first render on %s', async (preference) => {
    const create = (halfAlphaRed: Texture) => new FlatMaterial({ baseColorTexture: halfAlphaRed, alphaMode: 'blend' });

    await withPlane(preference, create, async (centrePixel, material) => {
      const pixelAfter = (mode: AlphaMode): Promise<number[]> => {
        material.alphaMode = mode;
        return centrePixel();
      };

      expect((await pixelAfter('blend'))[1]).toBeGreaterThan(64);
      expectOpaqueRed(await pixelAfter('opaque'));
      expect((await pixelAfter('blend'))[1]).toBeGreaterThan(64);
    });
  });
});
