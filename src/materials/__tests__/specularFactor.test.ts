import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { ColorCubeTexture } from '~/core/textures/ColorCubeTexture';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { srgbToLinear } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Material3DOptions } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

function dielectric(factor: number): Material3DOptions {
  return { baseColor: 0x000000, metallic: 0, roughness: 0.1, specular: { factor } };
}

async function brightestReflection(
  preference: 'webgl' | 'webgpu',
  name: string,
  material: Material3DOptions,
): Promise<number> {
  const app = await getApp<Renderer>({
    id: `specular-factor-environment-${name}-${preference}`,
    appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
  });
  const environment = ColorCubeTexture.from(0xffffff);
  const faceSources = Object.values(environment.source.faces);
  const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none', environment });

  try {
    app.stage.addChild(view3d);
    view3d.root.addChild(
      new Mesh3D({
        geometry: new SphereGeometry({ radius: 1, widthSegments: 64, heightSegments: 48 }),
        material: new Material3D(material),
        castShadow: false,
        receiveShadow: false,
      }),
    );
    view3d.camera.fov = 50;
    view3d.camera.position.set(0, 0, 3);

    const pixels = await renderFrame(app);
    let brightest = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      brightest = Math.max(brightest, pixels[i], pixels[i + 1], pixels[i + 2]);
    }

    return brightest;
  } finally {
    view3d.destroy({ children: true, geometry: true, material: true });
    environment.destroy(true);
    for (const source of faceSources) source.destroy();
    app.destroy(true);
  }
}

async function darkestThroughGlass(
  preference: 'webgl' | 'webgpu',
  name: string,
  options: Material3DOptions,
): Promise<number> {
  const app = await getApp<Renderer>({
    id: `specular-factor-glass-${name}-${preference}`,
    appOptions: {
      preference,
      width: SIZE,
      height: SIZE,
      resolution: 1,
      backgroundColor: 0xffffff,
      useBackBuffer: true,
    },
  });
  const view3d = new View3D({ width: SIZE, height: SIZE, toneMapping: 'none' });

  try {
    app.stage.addChild(view3d);
    const wall = new Mesh3D({
      geometry: new PlaneGeometry({ width: 40, height: 40 }),
      material: new FlatMaterial({ baseColor: 0xffffff }),
    });
    wall.position.set(0, 0, -2);
    view3d.root.addChild(
      wall,
      new Mesh3D({
        geometry: new SphereGeometry({ radius: 1, widthSegments: 64, heightSegments: 48 }),
        material: new Material3D({
          baseColor: 0xffffff,
          metallic: 0,
          roughness: 0,
          transmission: { factor: 1, thickness: 0 },
          ...options,
        }),
        castShadow: false,
        receiveShadow: false,
      }),
    );
    view3d.camera.fov = 50;
    view3d.camera.position.set(0, 0, 3);

    const pixels = await renderFrame(app);
    let darkest = 255;
    for (let i = 0; i < pixels.length; i += 4) {
      darkest = Math.min(darkest, pixels[i], pixels[i + 1], pixels[i + 2]);
    }

    return darkest;
  } finally {
    view3d.destroy({ children: true, geometry: true, material: true });
    app.destroy(true);
  }
}

for (const preference of ['webgl', 'webgpu'] as const) {
  describe(`specular.factor and the environment reflection (${preference})`, () => {
    it('reflects nothing at factor 0, the grazing edges included', async () => {
      expect(
        await brightestReflection(preference, 'factor-1', dielectric(1)),
        'factor 1 reflects the environment at the edges',
      ).toBeGreaterThan(128);
      expect(await brightestReflection(preference, 'factor-0', dielectric(0))).toBeLessThan(4);
    });

    it('halves the reflection at factor 0.5, the grazing edges included', async () => {
      const full = srgbToLinear((await brightestReflection(preference, 'factor-1', dielectric(1))) / 255);
      const half = srgbToLinear((await brightestReflection(preference, 'factor-0.5', dielectric(0.5))) / 255);

      expect(half / full).toBeGreaterThan(0.4);
      expect(half / full).toBeLessThan(0.6);
    });

    it('leaves a metal reflecting the same at factor 0 as at factor 1', async () => {
      const metal = (factor: number): Material3DOptions => ({
        baseColor: 0x808080,
        metallic: 1,
        roughness: 0.1,
        specular: { factor },
      });
      const full = await brightestReflection(preference, 'metal-factor-1', metal(1));
      const none = await brightestReflection(preference, 'metal-factor-0', metal(0));

      expect(Math.abs(none - full)).toBeLessThanOrEqual(2);
    });
  });

  describe(`specular.factor and transmission (${preference})`, () => {
    it('lets glass at factor 0 pass all the light, the grazing edges included', async () => {
      expect(
        await darkestThroughGlass(preference, 'plain', {}),
        'plain glass lets less light through at the edges',
      ).toBeLessThan(224);
      expect(await darkestThroughGlass(preference, 'factor-0', { specular: { factor: 0 } })).toBeGreaterThan(250);
    });
  });
}
