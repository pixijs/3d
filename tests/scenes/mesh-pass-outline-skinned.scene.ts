import type { TestScene } from '@test-utils';
import { Assets } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

import { model } from '../../examples/assets/manifest';

const SKINNED = model('gltf.CesiumMan');

export const scene: TestScene = {
  assets: [SKINNED],
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0xe8eef4,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: 320,
      height: 220,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x334455 },
      passes: [new OutlinePass({ width: 0.02, color: 0x1a0f33 })],
    });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.4 }));
    const key = new DirectionalLight({ color: 0xffffff, intensity: 3 });
    key.position.set(3, 5, 4);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view.root.addChild(key);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 6, height: 6 }),
      material: new Material3D({ baseColor: 0xb8c4d4, roughness: 0.9 }),
      castShadow: false,
    });
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view.root.addChild(ground);

    const figure = new Model3D({ source: Assets.get<Scene3DSource>(SKINNED), autoUpdate: false });
    figure.position.set(0, 0, 0);
    view.root.addChild(figure);

    const [label] = figure.player?.animationLabels ?? [];
    if (figure.player && label) {
      const state = figure.player.getState(label);
      state.gotoAndStop(state.animation.duration * 0.35);
    }

    figure.traverse((container) => {
      if (container instanceof Mesh3D) container.material.enablePass('outline');
    });

    view.camera.fov = 40;
    view.camera.position.set(1.6, 1.5, 3.2);
    view.camera.lookAt({ x: 0, y: 0.8, z: 0 });

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
