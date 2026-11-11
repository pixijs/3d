import type { TestScene } from '@test-utils';
import { Container, Graphics, Text } from 'pixi.js';

import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x1a1a22,
  },
  create: async (app) => {
    const container = new Container();
    container.addChild(
      new Graphics().roundRect(0, 0, 512, 512, 48).fill(0x2266cc),
      new Graphics().circle(256, 175, 110).fill(0xffcc33),
    );
    const label = new Text({ text: '2D → 3D', style: { fill: 0xffffff, fontSize: 84, fontWeight: 'bold' } });
    label.anchor.set(0.5);
    label.position.set(256, 380);
    container.addChild(label);

    const texture = new ContainerTexture({ container, width: 512, height: 512, resolution: 1 });

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const plane = new Mesh3D({
      geometry: new PlaneGeometry({ width: 2.2, height: 2.2 }),
      material: new FlatMaterial({
        baseColor: 'white',
        baseColorTexture: texture,
      }),
      castShadow: false,
      receiveShadow: false,
    });
    plane.rotation.set(-0.35, 0.5, 0);
    view3d.root.addChild(plane);

    view3d.camera.position.set(0, 0, 3);

    texture.render(app.renderer);
  },
};
