import { getApp, renderFrame } from '@test-utils';
import type { Application, Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

const SHADOW_PIXELS = 100;

function sunOverGround(app: Application<Renderer>): { view3d: View3D; sun: DirectionalLight } {
  const view3d = new View3D({ width: SIZE, height: SIZE });
  view3d.camera.position.set(0, 5, 5);
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  app.stage.addChild(view3d);

  const sun = new DirectionalLight({ intensity: 4, castShadow: true });
  sun.lookAt({ x: 0.5, y: -1, z: 0.4 });

  const ground = new Mesh3D({
    geometry: new PlaneGeometry({ width: 12, height: 12 }),
    material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
    castShadow: false,
  });
  ground.position.set(0, -0.5, 0);
  ground.rotation.set(-Math.PI / 2, 0, 0);

  view3d.root.addChild(sun, ground);

  return { view3d, sun };
}

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) n++;
  }
  return n;
}

const CASTERS = [
  {
    id: 'mesh',
    name: 'a mesh set to castShadow = false',
    add: (view3d: View3D) => {
      const cube = new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D(), castShadow: true });
      view3d.root.addChild(cube);
      return (casts: boolean) => {
        cube.castShadow = casts;
      };
    },
  },
  {
    id: 'batch',
    name: 'a batch slot moved out of the SHADOW pass',
    add: (view3d: View3D) => {
      const batched = new BatchedMesh3D({ size: 1 });
      batched.setGeometryAt(0, new CubeGeometry());
      batched.setMaterialAt(0, new Material3D());
      batched.setMatrixAt(0, new Matrix4());
      batched.setPassesAt(0, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
      view3d.root.addChild(batched);
      return (casts: boolean) =>
        batched.setPassesAt(0, casts ? RenderPassBit.OPAQUE | RenderPassBit.SHADOW : RenderPassBit.OPAQUE);
    },
  },
] as const;

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a casting light over an empty shadow pass (${preference})`, () => {
    it('lights receivers as a light that casts nothing would, when nothing has ever cast', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-empty-pass-never-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE },
      });

      try {
        const { sun } = sunOverGround(app);

        const drawn = await renderFrame(app);

        sun.castShadow = false;
        const unshadowed = await renderFrame(app);

        expect(differingPixels(drawn, unshadowed)).toBe(0);
      } finally {
        app.destroy();
      }
    });

    for (const { id, name, add } of CASTERS) {
      it(`drops the shadow of ${name}, and draws it again when it rejoins`, async () => {
        const app = await getApp<Renderer>({
          id: `shadow-empty-pass-left-${id}-${preference}`,
          appOptions: { preference, width: SIZE, height: SIZE },
        });

        try {
          const { view3d, sun } = sunOverGround(app);
          const setCasts = add(view3d);

          const shadowed = await renderFrame(app);

          setCasts(false);
          const left = await renderFrame(app);

          setCasts(true);
          const rejoined = await renderFrame(app);

          sun.castShadow = false;
          const unshadowed = await renderFrame(app);

          expect(differingPixels(shadowed, unshadowed), 'the caster drew a shadow first').toBeGreaterThan(
            SHADOW_PIXELS,
          );
          expect(differingPixels(left, unshadowed), 'the shadow left with the caster').toBe(0);
          expect(differingPixels(rejoined, shadowed), 'the shadow came back with the caster').toBe(0);
        } finally {
          app.destroy();
        }
      });
    }
  });
}
