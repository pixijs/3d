import type { TestScene } from '@test-utils';
import { BlurFilter, ColorMatrixFilter, Container, Graphics } from 'pixi.js';

import type { Geometry3D } from '~/geometry/Geometry3D';
import { TorusGeometry } from '~/geometry/TorusGeometry';
import { TorusKnotGeometry } from '~/geometry/TorusKnotGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const CARD = 220;

function buildCard(geometry: Geometry3D, color: number, metallic: number, cx: number, filter: unknown): Container {
  const outer = new Container();
  outer.position.set(cx, 180);

  const inner = new Container();
  inner.filters = filter as never;
  outer.addChild(inner);

  const panel = new Graphics()
    .roundRect(-CARD / 2, -CARD / 2, CARD, CARD, 18)
    .fill({ color: 0x10131c, alpha: 1 })
    .stroke({ color: 0x7aa2ff, width: 2, alpha: 0.7 });
  inner.addChild(panel);

  const view = new View3D({
    width: CARD - 32,
    height: CARD - 32,
    anchor: 0.5,
    environment: { skyColor: 0x9fb4ff, groundColor: 0x33263a, intensity: 1 },
  });
  inner.addChild(view);

  view.camera.fov = 35;
  view.camera.position.set(0, 1.6, 4);
  view.camera.lookAt({ x: 0, y: 0, z: 0 });

  const key = new DirectionalLight({ color: 0xfff2e0, intensity: 3 });
  key.position.set(3, 4, 5);
  key.lookAt({ x: 0, y: 0, z: 0 });
  view.root.addChild(key);

  const mesh = new Mesh3D({
    geometry,
    material: new Material3D({ baseColor: color, metallic, roughness: 0.3 }),
  });
  mesh.rotation.set(-0.5, 0.7, 0);
  view.root.addChild(mesh);

  return outer;
}

const monoMatrix = new ColorMatrixFilter();
monoMatrix.blackAndWhite(true);

export const scene: TestScene = {
  app: {
    width: 660,
    height: 360,
    backgroundColor: 0x12141c,
  },
  delay: 120,
  create: async (app) => {
    const knot = new TorusKnotGeometry({ radius: 0.8, tube: 0.28, p: 2, q: 3 });
    const torus = new TorusGeometry({ radius: 0.85, tube: 0.34 });

    const left = buildCard(knot, 0xffd27f, 0.9, 175, [new BlurFilter({ strength: 8, quality: 4 })]);
    const right = buildCard(torus, 0xff5a3c, 0.2, 485, [monoMatrix]);
    app.stage.addChild(left, right);
  },
};
