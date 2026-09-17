import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * Live auto-fit: with no explicit `shadow.bounds` and a scene under the shadow pass's
 * caster cap, the auto-fit box re-measures every rendered frame. The caster renders on
 * one side for a few frames (any fit-once behaviour would latch there), then moves to
 * the other side — the shadow must follow to the final frame with no app call.
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
      geometry: new PlaneGeometry({ width: 10, height: 10 }),
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
    caster.position.set(-2, 0, 0);
    view3d.root.addChild(caster);

    const sun = new DirectionalLight({
      color: 0xfff4e0,
      intensity: 6,
      castShadow: true,
    });
    sun.rotation.set((-40 * Math.PI) / 180, (30 * Math.PI) / 180, 0);
    view3d.root.addChild(sun);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 3.5, 7);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });

    // A few static frames on the left — a fit-once box would freeze around this spot.
    app.render();
    app.render();
    app.render();

    // Move to the right; the harness renders the final frame, where the shadow must
    // sit under the cube's new position.
    caster.position.set(2, 0, 0);
  },
};
