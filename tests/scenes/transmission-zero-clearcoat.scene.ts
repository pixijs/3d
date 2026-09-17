import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Regression scene for #73: a material constructed with transmission AND
 * clearcoat, with `transmission` set to 0 before the first frame. Feature
 * bits are locked at construction, so transmissionBit must stay in the
 * descriptor and the clearcoat texture slots must keep lining up with the
 * batcher's `_textures` packing.
 *
 * Pre-fix, dropping transmissionBit shifted the clearcoat samples down two
 * slots — `sampleClearcoatNormal` read WHITE instead of the flat NORMAL_MAP,
 * decoding to a garbage normal that relocated the lacquer highlight.
 * Expected render: a matte ball with a clean, sharp clearcoat highlight.
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0x202830,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    const material = new Material3D({
      baseColor: 0x8b2f3f,
      metallic: 0,
      roughness: 0.6,
      transmission: { factor: 1, thickness: 0.5 },
      clearcoat: { factor: 1, roughness: 0.05 },
    });

    // The #73 case: value write after construction — a pure data sync that
    // must not rebuild the shader variant.
    material.transmission!.factor = 0;

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.95, widthSegments: 32, heightSegments: 16 }),
      material,
      castShadow: false,
      receiveShadow: false,
    });
    view3d.root.addChild(sphere);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 8 });
    light.rotation.set(-0.65, 0.55, 0.25);
    view3d.root.addChild(light);

    view3d.camera.position.set(0, 0, 2.5);
  },
};
