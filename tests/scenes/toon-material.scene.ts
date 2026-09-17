import type { TestScene } from '@test-utils';

import { ToonMaterial } from '~/extras/materials/toon/ToonMaterial';
import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * The shipped toon recipe end to end: {@link ToonMaterial} on the meshes (banded diffuse, rim,
 * sharp specular, and an opt-in to the `outline` pass) with {@link OutlinePass} on the view.
 * Band count rises left to right so the quantisation reads directly; the right-most sphere
 * opts out of the outline to prove the per-material switch.
 */

const SIZE = 220;

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0x1a1a2e,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: 320,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x223344 },
      passes: [new OutlinePass({ width: 0.05 })],
    });
    view.camera.fov = 40;
    view.camera.position.set(0, 0.6, 5.2);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.25 }));
    const key = new DirectionalLight({ color: 0xffffff, intensity: 4 });
    key.position.set(3, 5, 4);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view.root.addChild(key);

    const geometry = new SphereGeometry({ radius: 0.6, widthSegments: 32, heightSegments: 24 });
    const palette = [0xe6404d, 0x33b366, 0x4073e6, 0xf2b326];
    for (let i = 0; i < 4; i++) {
      const mesh = new Mesh3D({
        geometry,
        material: new ToonMaterial({
          baseColor: palette[i],
          bands: i + 2,
          rimIntensity: 0.5,
          outline: i < 3,
        }),
      });
      mesh.position.set((i - 1.5) * 1.45, 0, 0);
      view.root.addChild(mesh);
    }

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
