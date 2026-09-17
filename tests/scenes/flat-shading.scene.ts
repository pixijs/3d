import type { TestScene } from '@test-utils';

import { SphereGeometry } from '~/geometry/SphereGeometry';
import { TorusKnotGeometry } from '~/geometry/TorusKnotGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * `flatShading` shades from face normals, on any material that reads a normal.
 *
 * Both columns share one geometry per row — only the material differs. The left
 * pair must read as smooth gradients, the right pair as hard-edged facets that
 * expose the tessellation. A broken derivative normal collapses the difference
 * (identical columns) or blows out to NaN (black facets), and either way fails
 * the pixel match.
 *
 * The flag lives on `BaseMaterial3D` and is injected by the material system, so
 * the second row uses `PhongMaterial` to pin that it isn't PBR-only.
 *
 * Low segment counts keep the facets large enough to survive the diff at
 * snapshot resolution.
 */
export const scene: TestScene = {
  app: {
    backgroundColor: 0x14161c,
  },
  create: async (app) => {
    const view3d = new View3D({
      width: app.screen.width,
      height: app.screen.height,
      environment: { skyColor: 0x8fa8c8, groundColor: 0x40382c, intensity: 0.6 },
      toneMapping: 'aces',
    });

    app.stage.addChild(view3d);

    const geometries = [
      new SphereGeometry({ radius: 0.62, widthSegments: 14, heightSegments: 9 }),
      new TorusKnotGeometry({ radius: 0.44, tube: 0.17, tubularSegments: 40, radialSegments: 7 }),
    ];

    for (let row = 0; row < geometries.length; row++) {
      for (const flatShading of [false, true]) {
        const material =
          row === 0
            ? new Material3D({ baseColor: 0xd8823c, metallic: 0.1, roughness: 0.42, flatShading })
            : new PhongMaterial({ baseColor: 0xd8823c, shininess: 48, flatShading });

        const mesh = new Mesh3D({
          geometry: geometries[row],
          material,
          castShadow: false,
          receiveShadow: false,
        });

        mesh.position.set(flatShading ? 0.85 : -0.85, row === 0 ? 0.75 : -0.75, 0);
        mesh.rotation.set(0.5, 0.7, 0);
        view3d.root.addChild(mesh);
      }
    }

    const sun = new DirectionalLight({ color: 0xfff2e0, intensity: 3.2 });

    sun.position.set(3, 4, 5);
    sun.lookAt({ x: 0, y: 0, z: 0 });
    view3d.root.addChild(sun);

    view3d.camera.position.set(0, 0, 4.4);
  },
};
