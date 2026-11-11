import { getApp, readCanvasPixels } from '@test-utils';
import { Assets } from 'pixi.js';
import type { Application, CubeTexture, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import '~/assets/init';
import type { HdrAssetData } from '~/assets/loaders/hdr/loadHdr';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const HALF_ENCODED = 255 * 0.5 ** (1 / 2.2);

function hdrFile(width: number, height: number, pixels: number[], format = '32-bit_rle_rgbe'): ArrayBuffer {
  const header = `#?RADIANCE\nFORMAT=${format}\n\n-Y ${height} +X ${width}\n`;
  const bytes = new Uint8Array(header.length + pixels.length);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i);
  bytes.set(pixels, header.length);
  return bytes.buffer;
}

function solidFile(exponent: number): ArrayBuffer {
  return hdrFile(16, 8, Array.from({ length: 16 * 8 }, () => [128, 128, 128, exponent]).flat());
}

async function expectLoadError(file: ArrayBuffer, message: RegExp): Promise<void> {
  const src = URL.createObjectURL(new Blob([file]));
  try {
    await expect(Assets.load({ src, parser: 'hdr' })).rejects.toThrow(message);
  } finally {
    URL.revokeObjectURL(src);
  }
}

function skyRed(app: Application<Renderer>): number {
  return readCanvasPixels(app.canvas, 1, 1, 1, 1)[0];
}

interface SkyOptions {
  preference: 'webgpu' | 'webgl';
  file: ArrayBuffer;
  exposure: number;
  data?: HdrAssetData;
}

async function withSky(
  { preference, file, exposure, data }: SkyOptions,
  run: (app: Application<Renderer>, view3d: View3D, sky: CubeTexture, src: string) => Promise<void> | void,
): Promise<void> {
  const size = 32;
  const app = await getApp<Renderer>({
    id: `load-hdr-${preference}`,
    appOptions: { preference, width: size, height: size, resolution: 1, backgroundColor: 0x000000 },
  });
  const src = URL.createObjectURL(new Blob([file]));
  const sky = await Assets.load<CubeTexture>({ src, parser: 'hdr', data });
  const view3d = new View3D({ width: size, height: size, toneMapping: 'none', exposure });
  view3d.root.addChild(new Mesh3D({ geometry: new SphereGeometry({ radius: 0.01 }), material: new Material3D() }));
  view3d.camera.position.set(0, 0, 3);
  view3d.background = sky;
  app.stage.addChild(view3d);
  try {
    await run(app, view3d, sky, src);
  } finally {
    view3d.background = 0x000000;
    app.render();
    await Assets.unload(src);
    URL.revokeObjectURL(src);
    view3d.destroy({ children: true, geometry: true, material: true });
    app.destroy();
  }
}

describe('loadHdr errors', () => {
  it('names what it cannot read', async () => {
    await expectLoadError(hdrFile(1, 1, [0, 0, 0, 0], '32-bit_rle_xyze'), /32-bit_rle_xyze/);
    await expectLoadError(new TextEncoder().encode('#?RADIANCE\n\n+X 1 -Y 1\n').buffer, /orientation/);
    await expectLoadError(hdrFile(2, 2, [1, 2, 3, 130]), /ends/);
    await expectLoadError(hdrFile(8, 1, [2, 2, 0, 8]), /ends/);
  });
});

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`loadHdr (${preference})`, () => {
    it('loads a panorama as a linear cube that shows its radiance above 1', async () => {
      await withSky(
        { preference, file: solidFile(130), exposure: 0.25, data: { faceSize: 8 } },
        async (app, view3d, sky, src) => {
          expect(sky.source.pixelWidth, 'data.faceSize sets the face width').toBe(8);

          app.render();
          expect(skyRed(app), 'radiance 2 at exposure 0.25 encodes to 0.5 ** (1 / 2.2)').toBeCloseTo(HALF_ENCODED, -1);

          sky.source.unload();
          app.render();
          expect(skyRed(app), 'the next render uploads the unloaded cube again').toBeCloseTo(HALF_ENCODED, -1);

          view3d.background = 0x000000;
          app.render();
          const faces = Object.values(sky.source.faces);
          await Assets.unload(src);
          expect(sky.source.destroyed).toBe(true);
          expect(
            faces.every((face) => face.destroyed),
            'the faces the loader made go with the cube',
          ).toBe(true);
        },
      );
    });

    it('caps radiance the cube cannot hold at its largest value instead of infinity', async () => {
      await withSky({ preference, file: solidFile(159), exposure: 0.5 / 64512 }, (app) => {
        app.render();
        expect(skyRed(app), 'radiance near 1e9 stores as 64512').toBeCloseTo(HALF_ENCODED, -1);
      });
    });
  });
}
