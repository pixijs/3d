import type { TestScene } from '@test-utils';
import { Assets } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

import { model } from '../../examples/assets/manifest';

const MORPH_CUBE = model('gltf.AnimatedMorphCube');

export const scene: TestScene = {
  assets: [MORPH_CUBE],
  app: {
    backgroundColor: 0x1e2024,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const source = Assets.get<Scene3DSource>(MORPH_CUBE);
    const phases = [0.0, 0.35, 0.7];
    const spacing = 2.6;

    phases.forEach((phase, i) => {
      const cube = new Model3D({ source, autoUpdate: false });
      cube.position.set((i - (phases.length - 1) / 2) * spacing, 0, 0);
      view3d.root.addChild(cube);

      if (cube.player) {
        const [label] = cube.player.animationLabels;
        if (label) {
          const state = cube.player.getState(label);
          state.gotoAndStop(state.animation.duration * phase);
        }
      }
    });

    const key = new DirectionalLight({ color: 0xffffff, intensity: 7 });
    key.rotation.set(-0.7, 0.6, 0);
    view3d.root.addChild(key);

    const fill = new DirectionalLight({ color: 0xbcd0ff, intensity: 3 });
    fill.rotation.set(-0.2, -0.9, 0);
    view3d.root.addChild(fill);

    view3d.camera.position.set(0, 2.4, 8);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
