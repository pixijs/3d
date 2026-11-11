import { expectCleanRender, getApp } from '@test-utils';
import type { Renderer } from 'pixi.js';
import { describe, it } from 'vitest';

import { TintEffect } from '~/extras/post-processing/effects/TintEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';
import type { View3DOptions } from '~/scene/View3D';

const WIDTH = 200;
const HEIGHT = 160;

function view(options: Partial<View3DOptions>): View3D {
  const view3d = new View3D({ width: WIDTH, height: HEIGHT, passes: [new TintEffect()], ...options });
  view3d.camera.position.z = 4;
  view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  view3d.root.addChild(new Mesh3D({ geometry: new CubeGeometry(), material: new Material3D({ baseColor: 0x44aaff }) }));
  return view3d;
}

for (const preference of ['webgpu'] as const) {
  describe(`a tint effect, which reads no depth (${preference})`, () => {
    it('draws three clean frames with a blended mesh in the scene', async () => {
      const app = await getApp<Renderer>({
        id: `global-slot-attachment-blended-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT },
      });
      try {
        const view3d = view({});
        const glass = new Mesh3D({
          geometry: new PlaneGeometry({ width: 3, height: 3 }),
          material: new Material3D({ alpha: 0.4, alphaMode: 'blend' }),
        });
        glass.position.set(0, 0, 1);
        view3d.root.addChild(glass);
        app.stage.addChild(view3d);

        await expectCleanRender(app);
        await expectCleanRender(app);
        await expectCleanRender(app);
      } finally {
        app.destroy(true);
      }
    });

    it('draws three clean frames with a hemisphere background', async () => {
      const app = await getApp<Renderer>({
        id: `global-slot-attachment-background-${preference}`,
        appOptions: { preference, width: WIDTH, height: HEIGHT },
      });
      try {
        app.stage.addChild(view({ background: { skyColor: 0x223355, groundColor: 0x111111 } }));

        await expectCleanRender(app);
        await expectCleanRender(app);
        await expectCleanRender(app);
      } finally {
        app.destroy(true);
      }
    });
  });
}
