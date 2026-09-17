import type { TestScene } from '@test-utils';

import { WireframePass } from '~/extras/post-processing/passes/WireframePass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { TorusGeometry } from '~/geometry/TorusGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

/**
 * A {@link MeshPass} with a topology override: the {@link WireframePass} redraws every mesh
 * whose material opts into `wireframe` as line primitives over the shaded result. Two meshes
 * opt in and one doesn't, so the opt-in reads straight off the frame.
 */

const SIZE = 220;

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0x0e0e18,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: 320,
      height: SIZE,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x334455 },
      passes: [new WireframePass({ color: 0x00ff66 })],
    });
    view.camera.fov = 40;
    view.camera.position.set(0, 1.4, 5.4);
    view.camera.lookAt({ x: 0, y: 0.1, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.4 }));
    const key = new DirectionalLight({ color: 0xffffff, intensity: 3 });
    key.position.set(3, 5, 4);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view.root.addChild(key);

    const wired = new Material3D({ baseColor: 0x4488ff, roughness: 0.55, passes: { wireframe: true } });
    const plain = new Material3D({ baseColor: 0xff7733, roughness: 0.55 });

    const sphere = new Mesh3D({ geometry: new SphereGeometry({ radius: 0.7 }), material: wired });
    sphere.position.set(-1.5, 0.1, 0);
    view.root.addChild(sphere);

    const torus = new Mesh3D({ geometry: new TorusGeometry({ radius: 0.55, tube: 0.22 }), material: wired });
    torus.rotation.set(0.9, 0.3, 0);
    torus.position.set(0.1, 0.1, 0);
    view.root.addChild(torus);

    const bare = new Mesh3D({ geometry: new CubeGeometry({ width: 1.1, height: 1.1, depth: 1.1 }), material: plain });
    bare.rotation.set(0.35, 0.6, 0);
    bare.position.set(1.7, 0.1, 0);
    view.root.addChild(bare);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
