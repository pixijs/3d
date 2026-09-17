import type { TestScene } from '@test-utils';
import { Assets } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

/**
 * End-to-end glTF morph test: Khronos `AnimatedMorphCube` (POSITION deltas +
 * an animated `weights` channel). Exercises the whole loader path — morph
 * target decode, the `weights` → `Track` mapping, and the
 * `FloatArrayBinding` driving `mesh.weights` — sampled at a fixed time for a
 * deterministic frame. Both backends show the morphed pose (each keeps its
 * own reference).
 */
export const scene: TestScene = {
  assets: ['AnimatedMorphCube.glb'],
  app: {
    backgroundColor: 0x1e2024,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const source = Assets.get<Scene3DSource>('AnimatedMorphCube.glb');
    // Manual playback so we can pin a deterministic frame instead of relying on
    // wall-clock ticks.
    const model = new Model3D({ source, autoUpdate: false });
    view3d.root.addChild(model);

    if (model.player) {
      const [label] = model.player.animationLabels;
      if (label) {
        const state = model.player.getState(label);
        // Mid-animation: the cube is clearly deformed away from its base pose.
        state.gotoAndStop(state.animation.duration * 0.4);
      }
    }

    const key = new DirectionalLight({ color: 0xffffff, intensity: 7 });
    key.rotation.set(-0.7, 0.6, 0);
    view3d.root.addChild(key);

    const fill = new DirectionalLight({ color: 0xbcd0ff, intensity: 3 });
    fill.rotation.set(-0.2, -0.9, 0);
    view3d.root.addChild(fill);

    view3d.camera.position.set(2.4, 1.8, 2.8);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
