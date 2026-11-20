import { getApp, renderFrame } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 128;

const timeGateBit: ShaderBit = {
  name: 'testShadowTimeGate',
  gpu: {
    vertex: {
      end: 'clipPosition = select(vec4<f32>(2.0, 2.0, 2.0, 1.0), clipPosition, global.uTime > 0.0);',
    },
  },
  gl: {
    vertex: {
      end: 'gl_Position = uTime > 0.0 ? gl_Position : vec4(2.0, 2.0, 2.0, 1.0);',
    },
  },
};

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) n++;
  }
  return n;
}

for (const preference of ['webgpu', 'webgl'] as const) {
  describe(`a shadow shader that reads a global uniform (${preference})`, () => {
    it('compiles, draws without errors and casts its shadow', async () => {
      const app = await getApp<Renderer>({
        id: `shadow-pass-global-uniforms-${preference}`,
        appOptions: { preference, width: SIZE, height: SIZE, backgroundColor: 0x101014 },
      });

      try {
        const view3d = new View3D({ width: SIZE, height: SIZE, shadowQuality: 'low' });
        view3d.camera.position.set(0, 9, 0.01);
        view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
        app.stage.addChild(view3d);

        const floor = new Mesh3D({
          geometry: new PlaneGeometry({ width: 20, height: 20 }),
          material: new Material3D({ baseColor: 0xb0b0b0, metallic: 0, roughness: 0.95 }),
          castShadow: false,
        });
        floor.rotation.set(-Math.PI / 2, 0, 0);
        const sun = new DirectionalLight({ color: 0xffffff, intensity: 4, castShadow: true });
        sun.rotation.set((-45 * Math.PI) / 180, (35 * Math.PI) / 180, 0);
        view3d.root.addChild(floor, sun);

        app.render();

        const caster = new Mesh3D({
          geometry: new CubeGeometry({ width: 1.5, height: 1.5, depth: 1.5 }),
          material: new Material3D({ baseColor: 0x4a7c59, passes: { shadow: { extraBits: [timeGateBit] } } }),
        });
        caster.position.set(0, 1.5, 0);
        view3d.root.addChild(caster);

        await renderFrame(app);
        const casting = await renderFrame(app);

        caster.castShadow = false;
        await renderFrame(app);
        const notCasting = await renderFrame(app);

        expect(differingPixels(casting, notCasting), 'the pixels the caster shadows').toBeGreaterThan(100);
      } finally {
        app.destroy();
      }
    });
  });
}
