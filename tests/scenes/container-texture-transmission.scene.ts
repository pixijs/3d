import type { TestScene } from '@test-utils';
import { Container } from 'pixi.js';

import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 384;

export const scene: TestScene = {
  app: { backgroundColor: 0x0c0e16 },
  create: async (app) => {
    const innerView = new View3D({ width: SIZE, height: SIZE });
    innerView.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.5 }));
    const key = new DirectionalLight({ color: 0xfff4e0, intensity: 3 });
    key.position.set(3, 4, 5);
    key.lookAt({ x: 0, y: 0, z: 0 });
    innerView.root.addChild(key);

    const topBar = new Mesh3D({
      geometry: new CubeGeometry({ width: 2, height: 0.7, depth: 0.2 }),
      material: new Material3D({ baseColor: 0xff4444, metallic: 0.1, roughness: 0.6 }),
    });
    topBar.position.set(0, 0.7, -1);
    innerView.root.addChild(topBar);

    const bottomBar = new Mesh3D({
      geometry: new CubeGeometry({ width: 2, height: 0.7, depth: 0.2 }),
      material: new Material3D({ baseColor: 0x4488ff, metallic: 0.1, roughness: 0.6 }),
    });
    bottomBar.position.set(0, -0.7, -1);
    innerView.root.addChild(bottomBar);

    const glass = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.4, height: 1.4, depth: 1.4 }),
      material: new Material3D({
        baseColor: 0xffffff,
        metallic: 0,
        roughness: 0.05,
        transmission: { factor: 1, thickness: 0.6 },
        ior: 1.5,
      }),
      castShadow: false,
      receiveShadow: false,
    });
    glass.rotation.set(-0.3, 0.5, 0);
    innerView.root.addChild(glass);

    innerView.camera.fov = 40;
    innerView.camera.position.set(0, 0, 4.5);
    innerView.camera.lookAt({ x: 0, y: 0, z: 0 });

    const innerContent = new Container();
    innerContent.addChild(innerView);
    const innerTexture = new ContainerTexture({ container: innerContent, width: SIZE, height: SIZE, resolution: 1 });

    const outerView = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(outerView);
    const outerCube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.8, height: 1.8, depth: 1.8 }),
      material: new FlatMaterial({ baseColor: 'white', baseColorTexture: innerTexture }),
      castShadow: false,
      receiveShadow: false,
    });
    outerCube.rotation.set(-0.4, 0.6, 0);
    outerView.root.addChild(outerCube);
    outerView.camera.position.set(0, 0, 4.5);

    innerTexture.render(app.renderer);
    innerTexture.render(app.renderer);
  },
};
