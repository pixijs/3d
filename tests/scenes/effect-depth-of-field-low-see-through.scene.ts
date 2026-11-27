import type { TestScene } from '@test-utils';

import { DepthOfFieldEffect } from '~/extras/post-processing/effects/DepthOfFieldEffect';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 200;

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0xf2efe8,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: SIZE,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      passes: [
        new DepthOfFieldEffect({ focusDistance: 5, focusRange: 0.4, focusFalloff: 0.4, maxBlur: 12, quality: 'low' }),
      ],
    });
    view.camera.fov = 45;
    view.camera.position.set(0, 0, 5);

    const sharp = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.6, widthSegments: 48, heightSegments: 32 }),
      material: new FlatMaterial({ baseColor: 0xff7733 }),
    });
    sharp.position.set(-0.7, 0.3, 0);
    view.root.addChild(sharp);

    const near = new Mesh3D({
      geometry: new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.8 }),
      material: new FlatMaterial({ baseColor: 0x2266dd }),
    });
    near.position.set(0.5, -0.5, 2.5);
    near.rotation.set(0.4, 0.6, 0);
    view.root.addChild(near);

    const far = new Mesh3D({
      geometry: new SphereGeometry({ radius: 1.2, widthSegments: 48, heightSegments: 32 }),
      material: new FlatMaterial({ baseColor: 0x22aa66 }),
    });
    far.position.set(1.8, 1.2, -6);
    view.root.addChild(far);

    const bar = new Mesh3D({
      geometry: new CubeGeometry({ width: 2.4, height: 0.05, depth: 0.05 }),
      material: new FlatMaterial({ baseColor: 0x111111 }),
    });
    bar.position.set(0, -1.1, 0);
    view.root.addChild(bar);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
