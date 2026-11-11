import type { TestScene } from '@test-utils';
import { BufferImageSource, CubeTexture, Texture } from 'pixi.js';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

function colorFace(r: number, g: number, b: number): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array([r, g, b, 255]),
      format: 'rgba8unorm',
      width: 1,
      height: 1,
      alphaMode: 'premultiply-alpha-on-upload',
    }),
  });
}

export const scene: TestScene = {
  app: {
    backgroundColor: 0x000000,
  },
  delay: 100,
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.background = CubeTexture.from({
      faces: {
        right: colorFace(220, 60, 60),
        left: colorFace(60, 200, 200),
        top: colorFace(70, 200, 90),
        bottom: colorFace(200, 70, 200),
        front: colorFace(70, 110, 220),
        back: colorFace(220, 200, 70),
      },
    });

    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.2, height: 1.2, depth: 1.2 }),
      material: new Material3D({ baseColor: 0xdddddd, metallic: 0, roughness: 0.5 }),
      castShadow: false,
      receiveShadow: false,
    });
    cube.rotation.set(-0.4, 0.6, 0.1);
    view3d.root.addChild(cube);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 6 });
    light.rotation.set(-0.65, 0.55, 0.25);
    view3d.root.addChild(light);

    view3d.camera.position.set(2.5, 1.5, 2.5);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
