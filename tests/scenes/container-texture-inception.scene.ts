import type { TestScene } from '@test-utils';
import { Container, Graphics, Text } from 'pixi.js';

import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

// Static snapshot of the `container-texture-inception` example: a 2D container holding a 3D view (inner
// spinning cube) is rendered to a ContainerTexture, which textures an outer cube. 3D in 2D in 3D.
export const scene: TestScene = {
  app: {
    backgroundColor: 0x0c0e16,
  },
  create: async (app) => {
    const SIZE = 512;

    // Inner: a 2D container containing a 3D view of a cube + a 2D overlay.
    const innerContent = new Container();
    const innerView = new View3D({ width: SIZE, height: SIZE });

    const keyLight = new DirectionalLight({ color: 0xffffff, intensity: 6 });
    keyLight.rotation.set(-0.6, 0.6, 0);
    innerView.root.addChild(keyLight);

    const fillLight = new DirectionalLight({ color: 0x88aaff, intensity: 3 });
    fillLight.rotation.set(0.5, -0.8, 0);
    innerView.root.addChild(fillLight);

    const innerCube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.1, height: 1.1, depth: 1.1 }),
      material: new Material3D({ baseColor: 0xff7a33, metallic: 0.1, roughness: 0.45 }),
    });
    innerCube.rotation.set(0.5, 0.7, 0);
    innerView.root.addChild(innerCube);
    innerView.camera.position.set(0, 0, 3);

    const overlay = new Text({ text: '3D ▸ in 2D', style: { fill: 0xffffff, fontSize: 44, fontWeight: 'bold' } });
    overlay.position.set(28, 24);
    const accent = new Graphics().roundRect(28, 80, 180, 10, 5).fill(0xffcc33);

    innerContent.addChild(innerView, overlay, accent);

    const innerTexture = new ContainerTexture({
      container: innerContent,
      width: SIZE,
      height: SIZE,
      resolution: 1,
    });

    // Outer: a cube textured with the entire inner scene.
    const outerView = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(outerView);

    const outerCube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.8, height: 1.8, depth: 1.8 }),
      material: new FlatMaterial({
        baseColor: 'white',
        baseColorTexture: innerTexture,
      }),
      castShadow: false,
      receiveShadow: false,
    });
    outerCube.rotation.set(-0.4, 0.6, 0);
    outerView.root.addChild(outerCube);

    outerView.camera.position.set(0, 0, 4.5);

    // Rendered manually, before the harness draws the scene, so the outer cube samples the inner scene.
    innerTexture.render(app.renderer);
  },
};
