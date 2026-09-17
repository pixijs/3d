import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Ambient-light energy lock.
 *
 * The ambient diffuse term carries the `1/PI` Lambertian normalization, the
 * same as the direct-light diffuse, so an `AmbientLight` reads at the correct
 * energy scale instead of ~PI (≈3.14×) too bright. Tone mapping is `'none'`,
 * so each sphere's encoded colour is `ambient * albedo * INV_PI` directly with
 * no curve to mask drift — drop the `INV_PI` and every sphere jumps brighter
 * (bright channels clip toward white), failing the pixel match.
 *
 * Lit by ambient only (no directional), so the spheres are flat discs whose
 * value is purely the ambient energy across R/G/B/white.
 */
const COLORS = [0xffffff, 0xff3030, 0x32d24a, 0x3060ff];

export const scene: TestScene = {
  app: {
    backgroundColor: 0x101014,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      toneMapping: 'none',
    });

    app.stage.addChild(view3d);

    const geometry = new SphereGeometry({ radius: 0.42, widthSegments: 32, heightSegments: 16 });
    const spacing = 1.05;
    const start = -((COLORS.length - 1) * spacing) / 2;

    for (let i = 0; i < COLORS.length; i++) {
      const sphere = new Mesh3D({
        geometry,
        material: new Material3D({ baseColor: COLORS[i], metallic: 0, roughness: 1 }),
        castShadow: false,
        receiveShadow: false,
      });

      sphere.position.set(start + i * spacing, 0, 0);
      view3d.root.addChild(sphere);
    }

    view3d.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 1 }));

    view3d.camera.position.set(0, 0, 4.2);
  },
};
