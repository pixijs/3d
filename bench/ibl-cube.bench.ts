/**
 * `ibl-cube`: a small scene lit by a cube environment, the way the pmndrs ports light theirs: one studio cube set as
 * the view's environment and a few dozen PBR meshes reflecting it. The view pipe binds the environment's prefiltered
 * cube each frame, so `cpu.render` carries that bind beside a render light enough for it to show; the cube itself is
 * baked once, during warm-up.
 */

import { ColorCubeTexture, Material3D, Mesh3D, SphereGeometry } from '@pixi/3d';
import { frame } from 'benchy';

import type { PixiStage } from './stage.ts';

frame('ibl-cube', {
  primary: 'cpu.render',
  create(stage: PixiStage) {
    const { view } = stage;
    const environment = ColorCubeTexture.fromRGB(180, 190, 210);
    view.environment = environment;

    const geometry = new SphereGeometry({ radius: 2 });
    const materials: Material3D[] = [];
    for (let i = 0; i < 6; i++) {
      materials.push(new Material3D({ baseColor: 0xffffff, metallic: i / 5, roughness: 0.1 + (i / 5) * 0.8 }));
    }
    for (let row = 0; row < 6; row++) {
      for (let column = 0; column < 6; column++) {
        const mesh = new Mesh3D({ geometry, material: materials[column], castShadow: false, receiveShadow: false });
        mesh.position.set((column - 2.5) * 5, (row - 2.5) * 5, 0);
        view.root.addChild(mesh);
      }
    }

    return {
      update() {},
      destroy() {
        view.environment = null;
        geometry.destroy(true);
        for (const material of materials) material.destroy();
        environment.destroy(true);
      },
    };
  },
});
