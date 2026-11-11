import { expectCleanRender, getApp } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { TiltShiftEffect } from '~/extras/post-processing/effects/TiltShiftEffect';
import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const WIDTH = 200;
const HEIGHT = 160;

function refractiveCube(): Mesh3D {
  const material = new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 0.1, transmission: { factor: 1 } });
  material._passBit = RenderPassBit.BLENDED_REFRACTION;
  const mesh = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material,
    castShadow: false,
    receiveShadow: false,
  });
  mesh.position.set(0.8, 0, 0);
  return mesh;
}

function refractionView(passes: TintEffect[] = []): View3D {
  const view3d = new View3D({ width: WIDTH, height: HEIGHT, passes });
  view3d.camera.position.z = 4;
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(new DirectionalLight({ intensity: 3 }));

  const opaque = new Mesh3D({
    geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
    material: new Material3D({ baseColor: 0xff8800, metallic: 0, roughness: 0.5 }),
  });
  opaque.position.set(-0.8, 0, -1);
  view3d.root.addChild(opaque);
  view3d.root.addChild(refractiveCube());

  return view3d;
}

function glassView(passes: (TiltShiftEffect | TintEffect)[]): View3D {
  const view3d = new View3D({ width: WIDTH, height: HEIGHT, passes });
  view3d.camera.position.set(1.2, 0.8, 4);
  view3d.camera.lookAt({ x: 0, y: 0, z: -0.5 });
  view3d.root.addChild(new DirectionalLight({ intensity: 4 }));

  const ball = new Mesh3D({
    geometry: new SphereGeometry({ radius: 0.45 }),
    material: new Material3D({ baseColor: 0xe0503a, roughness: 0.5 }),
  });
  ball.position.set(0, 0, -1.5);
  view3d.root.addChild(ball);
  view3d.root.addChild(
    new Mesh3D({
      geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 0.2 }),
      material: new Material3D({ transmission: { factor: 1, thickness: 0.5 }, ior: 1.5, roughness: 0.25 }),
    }),
  );

  return view3d;
}

for (const preference of ['webgpu'] as const) {
  describe(`a render graph rebuilt with no resize in between (${preference})`, () => {
    async function withApp(id: string, run: (app: Application<Renderer>) => Promise<void>): Promise<void> {
      const app = await getApp<Renderer>({
        id: `transient-rebuild-${id}-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT, backgroundColor: 0x101018, autoStart: false },
      });
      try {
        await run(app);
      } finally {
        app.destroy(true);
      }
    }

    it('keeps drawing when an effect is added while a pass samples the opaque depth copy', async () => {
      await withApp('effect-added', async (app) => {
        const view3d = refractionView();
        app.stage.addChild(view3d);
        await expectCleanRender(app);
        await expectCleanRender(app);

        view3d.passes = [new TintEffect()];
        await expectCleanRender(app);
        await expectCleanRender(app);
        await expectCleanRender(app);
      });
    });

    it('keeps drawing when a disabled effect is turned on', async () => {
      await withApp('effect-enabled', async (app) => {
        const tint = new TintEffect();
        tint.enabled = false;
        const view3d = refractionView([tint]);
        app.stage.addChild(view3d);
        await expectCleanRender(app);
        await expectCleanRender(app);

        tint.enabled = true;
        await expectCleanRender(app);
        await expectCleanRender(app);
        await expectCleanRender(app);
      });
    });

    it('keeps drawing when a disabled tilt-shift is turned on over glass', async () => {
      await withApp('tilt-shift-enabled', async (app) => {
        const tiltShift = new TiltShiftEffect({ enabled: false, focalDepth: 5, focalNear: 0.3, focalFar: 2 });
        const view3d = glassView([tiltShift, new TintEffect()]);
        app.stage.addChild(view3d);
        await expectCleanRender(app);
        await expectCleanRender(app);

        tiltShift.enabled = true;
        await expectCleanRender(app);
        await expectCleanRender(app);
        await expectCleanRender(app);
      });
    });
  });
}
