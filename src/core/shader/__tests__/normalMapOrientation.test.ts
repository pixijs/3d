import { getApp, readCanvasPixels } from '@test-utils';
import { BufferImageSource, Texture } from 'pixi.js';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { Geometry3D } from '~/geometry/Geometry3D';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 32;

function quad(vZeroAtTop: boolean, withTangents: boolean): Geometry3D {
  const top = vZeroAtTop ? 0 : 1;
  const bottom = 1 - top;
  const w = vZeroAtTop ? 1 : -1;

  return new Geometry3D({
    positions: new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, bottom, 1, bottom, 1, top, 0, top]),
    tangents: withTangents ? new Float32Array([1, 0, 0, w, 1, 0, 0, w, 1, 0, 0, w, 1, 0, 0, w]) : undefined,
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
}

function leaningNormalMap(axis: 'u' | 'v'): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array(axis === 'u' ? [218, 128, 218, 255] : [128, 218, 218, 255]),
      width: 1,
      height: 1,
      format: 'rgba8unorm',
      alphaMode: 'premultiply-alpha-on-upload',
    }),
  });
}

type Target = 'canvas' | 'render texture';

function litCentre(
  app: Application<Renderer>,
  target: Target,
  geometry: Geometry3D,
  normalTexture: Texture,
  rayX: number,
  rayY: number,
): number {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  app.stage.addChild(view3d);

  const light = new DirectionalLight({ intensity: 3 });
  light.lookAt({ x: rayX, y: rayY, z: -1 });
  view3d.root.addChild(light);

  const material = new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 1, normalTexture });
  view3d.root.addChild(new Mesh3D({ geometry, material }));
  view3d.camera.position.set(0, 0, 4);

  app.render();
  const red =
    target === 'canvas'
      ? readCanvasPixels(app.canvas, SIZE / 2, SIZE / 2, 1, 1)[0]
      : app.renderer.extract.pixels(view3d).pixels[((SIZE / 2) * SIZE + SIZE / 2) * 4];

  view3d.destroy({ children: true });
  material.destroy();

  return red;
}

const CASES = (['webgl', 'webgpu'] as const).flatMap((preference) =>
  (['canvas', 'render texture'] as const).flatMap((target) =>
    [true, false].flatMap((vZeroAtTop) =>
      [true, false].map((withTangents) => ({ preference, target, vZeroAtTop, withTangents })),
    ),
  ),
);

describe('a normal map leans the surface toward v = 0 for green and toward +u for red', () => {
  it.each(CASES)(
    '$preference, $target, v = 0 at top: $vZeroAtTop, vertex tangents: $withTangents',
    async ({ preference, target, vZeroAtTop, withTangents }) => {
      const app = await getApp<Renderer>({
        id: `normal-map-lean-${preference}-${target}-${vZeroAtTop}-${withTangents}`,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1 },
      });
      const geometry = quad(vZeroAtTop, withTangents);
      const green = leaningNormalMap('v');
      const red = leaningNormalMap('u');
      try {
        const fromAbove = litCentre(app, target, geometry, green, 0, -1);
        const fromBelow = litCentre(app, target, geometry, green, 0, 1);
        const [towardVZero, awayFromVZero] = vZeroAtTop ? [fromAbove, fromBelow] : [fromBelow, fromAbove];

        expect(towardVZero).toBeGreaterThan(awayFromVZero + 100);

        const fromRight = litCentre(app, target, geometry, red, -1, 0);
        const fromLeft = litCentre(app, target, geometry, red, 1, 0);

        expect(fromRight).toBeGreaterThan(fromLeft + 100);
      } finally {
        geometry.destroy();
        green.destroy(true);
        red.destroy(true);
        app.destroy();
      }
    },
  );
});
