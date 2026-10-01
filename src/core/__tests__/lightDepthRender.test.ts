import { getApp } from '@test-utils';
import { RendererType } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { expect, it, vi } from 'vitest';

import { LightTiles } from '~/core/LightTiles';
import type { RenderSession } from '~/core/render-passes/RenderSession';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { PointLight } from '~/scene/lights/PointLight';
import { SpotLight } from '~/scene/lights/SpotLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;
const EYE_Z = 10;
const WALL_Z = -8;
const LIGHT_Z = WALL_Z + 1.5;
const FOV = 75;

/** Read the rendered frame without issuing a second render through the extraction system. */
function canvasPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, copy.width, copy.height).data;
}

for (const preference of ['webgl', 'webgpu'] as const) {
  it.each(['pbr', 'phong'] as const)(
    'matches the unculled %s light loop through grid and light changes (' + preference + ')',
    async (model) => {
      const app = await getApp<Renderer>({
        id: 'light-grid-reference-' + preference + '-' + model,
        appOptions: { preference, width: SIZE, height: SIZE, resolution: 1, backgroundColor: 0x000000 },
      });
      const view3d = new View3D({ width: SIZE, height: SIZE });
      try {
        expect(app.renderer.type).toBe(preference === 'webgpu' ? RendererType.WEBGPU : RendererType.WEBGL);
        app.stage.addChild(view3d);
        const wall = new Mesh3D({
          geometry: new PlaneGeometry({ width: 80, height: 80 }),
          material:
            model === 'pbr' ? new Material3D({ baseColor: 0xffffff }) : new PhongMaterial({ baseColor: 0xffffff }),
          castShadow: false,
          receiveShadow: false,
        });
        wall.position.set(0, 0, WALL_Z);
        view3d.root.addChild(wall);
        view3d.camera.position.set(0, 0, EYE_Z);
        view3d.camera.fov = FOV;
        view3d.camera.far = 120;

        const sun = new DirectionalLight({ intensity: 0.2, castShadow: false });
        const unlimited = new PointLight({ intensity: 2, range: 0 });
        unlimited.position.set(0, 0, LIGHT_Z);
        const spot = new SpotLight({ intensity: 100, range: 6, coneAngle: 30, castShadow: false });
        spot.position.set(0, 0, WALL_Z + 4);
        spot.lookAt({ x: 0, y: 0, z: WALL_Z });
        const points = Array.from({ length: 29 }, (_, i) => {
          const light = new PointLight({ intensity: 80, range: 2.5 });
          light.position.set(((i % 7) - 3) * 3, (Math.floor(i / 7) - 2) * 3, LIGHT_Z);
          return light;
        });
        const lights = [sun, unlimited, spot, ...points];
        for (const light of lights) view3d.root.addChild(light);

        for (let phase = 0; phase < 7; phase++) {
          if (phase === 1) {
            points[28].position.set(8, 4, WALL_Z + 2);
            points[28].range = 9;
            spot.range = 12;
          }
          if (phase === 2) {
            for (let i = 0; i < points.length; i++) points[i].position.z = LIGHT_Z - (i % 4) * 10;
          }
          if (phase === 3) {
            view3d.camera.position.set(4, 2, EYE_Z + 5);
            view3d.camera.lookAt({ x: 0, y: 0, z: WALL_Z });
          }
          if (phase === 4) {
            view3d.camera.mode = 'orthographic';
            view3d.camera.orthographicSize = 16;
          }
          if (phase === 5) for (const light of lights.splice(8)) light.destroy();
          if (phase === 6) for (const light of lights.splice(0)) light.destroy();

          app.render();
          const actual = canvasPixels(app.canvas);
          expect(actual.some((value, i) => i % 4 !== 3 && value > 0)).toBe(phase !== 6);

          const reference = vi.spyOn(LightTiles.prototype, 'prepare').mockImplementation(function (
            this: LightTiles,
            session: RenderSession,
          ) {
            const count = session.view3d._lightDataList.count;
            this.masks.fill(count === 32 ? -1 : (1 << count) - 1);
            this.depthMasks.fill(-1);
            this.depthPlane.fill(0);
            return true;
          });
          try {
            app.render();
            const expected = canvasPixels(app.canvas);
            let differentChannels = 0;
            for (let i = 0; i < actual.length; i++) {
              if (actual[i] !== expected[i]) differentChannels++;
            }
            expect(differentChannels).toBe(0);
          } finally {
            reference.mockRestore();
          }
        }
      } finally {
        view3d.destroy({ children: true, geometry: true, material: true });
        app.destroy();
      }
    },
    15000,
  );
}

it.each(['webgl', 'webgpu'] as const)(
  'renders every %s light-mask bit and sparse combinations like the selected lights repacked alone',
  async (preference) => {
    const app = await getApp<Renderer>({
      id: 'light-mask-bit-iteration-' + preference,
      appOptions: { preference, width: 32, height: 32, resolution: 1, backgroundColor: 0x000000 },
    });
    const view = new View3D({ width: 32, height: 32 });
    const geometry = new PlaneGeometry({ width: 4, height: 4 });
    const material = new Material3D({ baseColor: 0xffffff, roughness: 0.6 });
    const lights = Array.from(
      { length: 32 },
      (_, i) =>
        new DirectionalLight({
          color: [0xffffff, 0xff8080, 0x80ff80, 0x8080ff][i % 4],
          intensity: 0.015 * (1 + (i % 5)),
          castShadow: false,
        }),
    );
    try {
      expect(app.renderer.type).toBe(preference === 'webgpu' ? RendererType.WEBGPU : RendererType.WEBGL);
      app.stage.addChild(view);
      view.camera.position.z = 5;
      view.root.addChild(new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false }));
      const masks = [
        0,
        ...Array.from({ length: 32 }, (_, i) => 1 << i),
        -1,
        0x80000001,
        0xaaaaaaaa,
        0x55555555,
        0x80204081,
      ];
      for (const mask of masks) {
        for (const light of lights) light.removeFromParent();
        for (const light of lights) view.root.addChild(light);
        const prepare = vi.spyOn(LightTiles.prototype, 'prepare').mockImplementation(function (this: LightTiles) {
          this.masks.fill(mask);
          this.depthMasks.fill(-1);
          this.depthPlane.fill(0);
          return true;
        });
        let actual: Uint8ClampedArray;
        try {
          app.render();
          actual = canvasPixels(app.canvas);
        } finally {
          prepare.mockRestore();
        }
        for (const light of lights) light.removeFromParent();
        for (let i = 0; i < lights.length; i++) if ((mask >>> i) & 1) view.root.addChild(lights[i]);
        app.render();
        const expected = canvasPixels(app.canvas);
        expect(actual.some((value, i) => i % 4 !== 3 && value > 0)).toBe(mask !== 0);
        expect(
          actual.every((value, i) => value === expected[i]),
          'mask ' + (mask >>> 0).toString(16),
        ).toBe(true);
      }
    } finally {
      for (const light of lights) light.destroy();
      view.destroy({ children: true });
      geometry.destroy();
      material.destroy();
      app.destroy();
    }
  },
  15000,
);
