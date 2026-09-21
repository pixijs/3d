import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Clearcoat and sheen in a view with no environment
 *
 * With no environment the PBR shader is composed without its IBL block and the BRDF lookup is
 * never made, yet the coat still fetches it: from the slot's placeholder, multiplied by zero
 * radiance. What is left in the picture is each layer's response to the light: the coat's
 * highlight and the dimming of the base under it, and the sheen's soft rim. The coat is rough on
 * purpose: its highlight has to cover more pixels than a scene is allowed to differ by, or
 * losing it would go unnoticed.
 *
 * Left to right: a bare dielectric, the same with a clearcoat, the same with sheen, and one
 * carrying both.
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0x101216,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const geometry = new SphereGeometry({ radius: 0.62, widthSegments: 48, heightSegments: 32 });
    const base = { baseColor: 0x8a2f2f, metallic: 0, roughness: 0.55 };

    const materials = [
      new Material3D(base),
      new Material3D({ ...base, clearcoat: { factor: 1, roughness: 0.3 } }),
      new Material3D({ ...base, sheen: { color: 0xfff1d6, roughness: 0.35 } }),
      new Material3D({
        ...base,
        clearcoat: { factor: 1, roughness: 0.3 },
        sheen: { color: 0xfff1d6, roughness: 0.35 },
      }),
    ];

    materials.forEach((material, i) => {
      const sphere = new Mesh3D({ geometry, material, castShadow: false, receiveShadow: false });
      sphere.position.set((i - 1.5) * 1.4, 0, 0);
      view3d.root.addChild(sphere);
    });

    const light = new DirectionalLight({ color: 0xffffff, intensity: 8 });
    light.rotation.set(-0.5, 0.55, 0);
    light.rotationDirty = true;
    view3d.root.addChild(light);

    view3d.camera.fov = 40;
    view3d.camera.position.set(0, 0, 8.6);
  },
};
