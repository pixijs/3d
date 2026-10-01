import type { TestScene } from '@test-utils';
import { Assets } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

import { model } from '../../examples/assets/manifest';

const URL = model('gltf.Fox');

const COLUMNS = 8;
const ROWS = 6;
const SPACING = 1.4;

/**
 * 48 skinned foxes (24 joints each, 1,152 bones) in one View3D: more than one 4,096-texel row of
 * the WebGL bone data texture. The bone pit starts under a row and doubles as the foxes are
 * added, so this exercises the growth path that has to keep the array covering whole rows. When
 * it doesn't, every bone upload fails and the foxes collapse to nothing.
 */
export const scene: TestScene = {
  assets: [URL],
  app: { backgroundColor: 0x191919 },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const source = Assets.get<Scene3DSource>(URL);
    const probe = new Model3D({ source, autoUpdate: false });
    const scale = 1 / probe.getLocalBounds().height;
    probe.destroy({ children: true });

    for (let i = 0; i < COLUMNS * ROWS; i++) {
      const fox = new Model3D({ source, autoUpdate: false });
      fox.scale.set(scale);
      fox.position.set(
        ((i % COLUMNS) - (COLUMNS - 1) / 2) * SPACING,
        0,
        (Math.floor(i / COLUMNS) - (ROWS - 1) / 2) * SPACING,
      );
      view3d.root.addChild(fox);
    }

    view3d.camera.position.set(7, 5, 10);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    view3d.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.4 }));
    const key = new DirectionalLight({ color: 0xffffff, intensity: 2.5 });
    key.rotation.set(-0.9, 0.5, 0);
    view3d.root.addChild(key);
  },
};
