import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Box } from '~/math/shapes/Box';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Fixed-box directional shadow: `shadow.bounds` gives the light a fixed
 * world-space shadow volume (a static box) that the pass renders as a
 * single cascade-slot-0 map. Verifies the fixed-volume directional path that
 * bypasses camera-frustum fitting. Static scene for determinism.
 */
export const scene: TestScene = {
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
      geometry: new PlaneGeometry({ width: 8, height: 8 }),
      material: new Material3D({ baseColor: 0x888888, metallic: 0, roughness: 0.85 }),
      castShadow: false,
    });
    ground.position.set(0, -0.5, 0);
    ground.rotation.set(-Math.PI / 2, 0, 0);
    view3d.root.addChild(ground);

    const caster = new Mesh3D({
      geometry: new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      material: new Material3D({ baseColor: 0x4a7c59, metallic: 0, roughness: 0.4 }),
      castShadow: true,
    });
    caster.rotation.set(0.3, 0.6, 0);
    view3d.root.addChild(caster);

    const sun = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 6,
      castShadow: true,
      shadow: { bounds: Box.fromCenterSize({ x: 0, y: 0, z: 0 }, 10) },
    });
    sun.rotation.set((-40 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 2, 4);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
