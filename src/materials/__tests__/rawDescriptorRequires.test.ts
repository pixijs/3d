import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { alphaMaskBit } from '~/core/shader/bits/alphaMaskBit';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { toonLightingBit, toonMaterialBit } from '~/extras/materials/toon/toonBit';
import { ToonMaterial } from '~/extras/materials/toon/ToonMaterial';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { flatMaterialBit } from '~/materials/flat/bits/flatMaterialBit';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 32;
const CENTRE = (SIZE / 2) * SIZE * 4 + (SIZE / 2) * 4;

const COLOUR_BITS: [string, ShaderBit[]][] = [
  ['toonMaterialBit', [toonMaterialBit, toonLightingBit]],
  ['flatMaterialBit', [flatMaterialBit]],
];

const HALF_RED = { baseColor: 0xff0000, alphaMode: 'blend' as const, alpha: 0.5 };

const ENGINE_MATERIALS: [string, () => BaseMaterial3D][] = [
  ['ToonMaterial', () => new ToonMaterial(HALF_RED)],
  ['Material3D', () => new Material3D(HALF_RED)],
  ['PhongMaterial', () => new PhongMaterial(HALF_RED)],
  ['FlatMaterial', () => new FlatMaterial(HALF_RED)],
];

async function blueThroughPlane(preference: 'webgpu' | 'webgl', id: string, material: BaseMaterial3D): Promise<number> {
  const app = await getApp<Renderer>({
    id,
    appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x0000ff },
  });

  try {
    const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });
    view3d.camera.position.set(0, 0, 3);
    app.stage.addChild(view3d);
    view3d.root.addChild(new Mesh3D({ geometry: new PlaneGeometry({ width: 4, height: 4 }), material }));

    return (await renderFrame(app))[CENTRE + 2];
  } finally {
    app.destroy();
  }
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a material built from a raw descriptor (${preference})`, () => {
    it('lays out what its bits require, so a colour bit and the alpha mask draw and cut', async () => {
      const app = await getApp<Renderer>({
        id: `raw-descriptor-requires-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x0000ff },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });
        view3d.camera.position.set(0, 0, 3);
        app.stage.addChild(view3d);

        const material = new BaseMaterial3D({
          descriptor: { bitsGpu: [flatMaterialBit, alphaMaskBit], bitsGl: [flatMaterialBit, alphaMaskBit] },
          baseColor: 0xff0000,
          alphaMode: 'mask',
          alpha: 0.6,
          alphaCutoff: 0.5,
        });
        view3d.root.addChild(new Mesh3D({ geometry: new PlaneGeometry({ width: 4, height: 4 }), material }));

        expect(material._slotByName.baseColor, 'the base colour texture the colour bit requires has a slot').toBe(0);

        const centre = (SIZE / 2) * SIZE * 4 + (SIZE / 2) * 4;
        const drawn = await renderFrame(app);
        expect([drawn[centre], drawn[centre + 2]], 'alpha 0.6 is over the cutoff, so the plane draws red').toEqual([
          255, 0,
        ]);

        material.alphaCutoff = 0.9;
        const cut = await renderFrame(app);
        expect([cut[centre], cut[centre + 2]], 'alpha 0.6 is under the cutoff, so the plane is cut').toEqual([0, 255]);
      } finally {
        app.destroy();
      }
    });

    for (const [name, bits] of COLOUR_BITS) {
      it(`sets alpha from the base colour with only ${name} listed, so a blended plane lets half the background through`, async () => {
        const material = new BaseMaterial3D({ descriptor: { bitsGpu: bits, bitsGl: bits }, ...HALF_RED });
        const blue = await blueThroughPlane(preference, `raw-descriptor-alpha-${name}-${preference}`, material);

        expect(blue, 'half the blue background shows through').toBeGreaterThan(100);
        expect(blue, 'half the blue background shows through').toBeLessThan(160);
      });
    }
  });

  describe(`an engine material at alpha 0.5 (${preference})`, () => {
    for (const [name, create] of ENGINE_MATERIALS) {
      it(`blends ${name} once: its colour bit and its own list both bring baseAlphaBit`, async () => {
        const blue = await blueThroughPlane(preference, `engine-material-alpha-${name}-${preference}`, create());

        expect(blue, 'half the blue background shows through, not three quarters').toBeGreaterThan(100);
        expect(blue, 'half the blue background shows through, not three quarters').toBeLessThan(160);
      });
    }
  });
}
