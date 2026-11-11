import type { TestScene } from '@test-utils';
import { Container, Graphics, Text } from 'pixi.js';

import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x0c0e16,
  },
  create: async (app) => {
    const SIZE = 512;
    const container = new Container();

    const bg = new Graphics().roundRect(0, 0, SIZE, SIZE, 28).fill('hsl(210, 55%, 16%)');
    const dots = new Graphics();
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2;
      const radius = 70 + i * 22;
      dots
        .circle(SIZE / 2 + Math.cos(angle) * radius, SIZE / 2 + Math.sin(angle) * radius, 26 - i * 1.5)
        .fill(`hsl(${(i / 7) * 360}, 85%, 62%)`);
    }
    const label = new Text({ text: 'LIVE', style: { fill: 0xffffff, fontSize: 110, fontWeight: 'bold' } });
    label.anchor.set(0.5);
    label.position.set(SIZE / 2, SIZE / 2);

    container.addChild(bg, dots, label);

    const texture = new ContainerTexture({ container, width: SIZE, height: SIZE, resolution: 1 });

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.6, height: 1.6, depth: 1.6 }),
      material: new FlatMaterial({
        baseColor: 'white',
        baseColorTexture: texture,
      }),
      castShadow: false,
      receiveShadow: false,
    });
    cube.rotation.set(-0.5, 0.7, 0);
    view3d.root.addChild(cube);

    view3d.camera.position.set(0, 0, 4);

    texture.render(app.renderer);
  },
};
