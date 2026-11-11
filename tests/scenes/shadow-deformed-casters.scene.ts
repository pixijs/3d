import type { TestScene } from '@test-utils';
import { Assets } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

import { model } from '../../examples/assets/manifest';

const SKINNED = model('gltf.CesiumMan');
const MORPHED = model('gltf.AnimatedMorphCube');

export const scene: TestScene = {
  assets: [SKINNED, MORPHED],
  app: {
    backgroundColor: 0x1a1a2e,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      shadowQuality: 'medium',
    });

    app.stage.addChild(view3d);

    const ground = new Mesh3D({
      geometry: new PlaneGeometry({ width: 10, height: 10 }),
      material: new Material3D({ baseColor: 0x9a9a9a, metallic: 0, roughness: 0.9 }),
      castShadow: false,
    });

    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const poseAt = (target: Model3D, fraction: number) => {
      const [label] = target.player?.animationLabels ?? [];

      if (!target.player || !label) return;

      const state = target.player.getState(label);

      state.gotoAndStop(state.animation.duration * fraction);
    };

    const skinned = new Model3D({ source: Assets.get<Scene3DSource>(SKINNED), autoUpdate: false });

    skinned.position.set(-0.9, 0, 0);
    view3d.root.addChild(skinned);
    poseAt(skinned, 0.35);

    const morphed = new Model3D({ source: Assets.get<Scene3DSource>(MORPHED), autoUpdate: false });

    morphed.position.set(1.1, 0.35, 0);
    morphed.scale.set(0.35, 0.35, 0.35);
    view3d.root.addChild(morphed);
    poseAt(morphed, 0.4);

    const sun = new DirectionalLight({ color: 0xfff4e0, intensity: 6, castShadow: true });

    sun.rotation.set((-32 * Math.PI) / 180, (38 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    const fill = new DirectionalLight({ color: 0xbcd0ff, intensity: 1.5 });

    fill.rotation.set(-0.2, -1.1, 0);
    view3d.root.addChild(fill);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0.4, 1.9, 3.4);
    view3d.camera.lookAt({ x: 0, y: 0.5, z: 0 });
  },
};
