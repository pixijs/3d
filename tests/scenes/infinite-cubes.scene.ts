import type { TestScene } from '@test-utils';
import { Container, Graphics, Text } from 'pixi.js';

import { ContainerTexture } from '~/core/textures/ContainerTexture';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: {
    backgroundColor: 0x05060c,
  },
  create: async (app) => {
    const W = app.screen.width;
    const H = app.screen.height;
    const aspect = W / H;

    const makeLayer = (level: number, material: BaseMaterial3D, lit: boolean): { container: Container } => {
      const container = new Container();
      container.addChild(new Graphics().rect(0, 0, W, H).fill(`hsl(${(level * 40) % 360}, 78%, 48%)`));

      const view = new View3D({ width: W, height: H });
      if (lit) {
        const key = new DirectionalLight({ color: 0xffffff, intensity: 6 });
        key.rotation.set(-0.6, 0.6, 0);
        view.root.addChild(key);
      }

      const cube = new Mesh3D({
        geometry: new CubeGeometry({ width: 2 * aspect, height: 2, depth: 2 }),
        material,
        castShadow: false,
        receiveShadow: false,
      });
      cube.rotation.set(-0.4, 0.6, 0);
      view.root.addChild(cube);

      view.camera.fov = 50;
      view.camera.position.set(0, 0, 7);

      const label = new Text({
        text: `LAYER ${level}`,
        style: { fill: 0xffffff, fontSize: 40, fontWeight: 'bold', stroke: { color: 0x000000, width: 5 } },
      });
      label.anchor.set(0.5, 0);
      label.position.set(W / 2, 24);

      container.addChild(view, label);
      return { container };
    };

    const base = makeLayer(0, new Material3D({ baseColor: 0xff7a33, metallic: 0.1, roughness: 0.45 }), true);
    const tex0 = new ContainerTexture({
      container: base.container,
      width: W,
      height: H,
      resolution: 1,
    });

    const layer1 = makeLayer(1, new FlatMaterial({ baseColor: 'white', baseColorTexture: tex0 }), false);
    const tex1 = new ContainerTexture({
      container: layer1.container,
      width: W,
      height: H,
      resolution: 1,
    });

    const layer2 = makeLayer(2, new FlatMaterial({ baseColor: 'white', baseColorTexture: tex1 }), false);
    app.stage.addChild(layer2.container);

    tex0.render(app.renderer);
    tex1.render(app.renderer);
  },
};
