import type { TestScene } from '@test-utils';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { dissolveBit } from '~/extras/materials/bits/dissolveBit';
import { ToonMaterial } from '~/extras/materials/toon/ToonMaterial';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import type { BaseMaterial3D } from '~/materials/BaseMaterial3D';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Material3D } from '~/materials/pbr/Material3D';
import { PhongMaterial } from '~/materials/phong/PhongMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const WIDTH = 540;
const HEIGHT = 360;
const SPACING = 1.4;

export const scene: TestScene = {
  app: { width: WIDTH, height: HEIGHT, backgroundColor: 0x1a1a2e },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: WIDTH,
      height: HEIGHT,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x223344 },
    });
    view.camera.fov = 40;
    view.camera.position.set(0, 0.25, 4.3);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.25 }));
    const key = new DirectionalLight({ color: 0xffffff, intensity: 4 });
    key.position.set(3, 5, 4);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view.root.addChild(key);

    const geometry = new SphereGeometry({ radius: 0.6, widthSegments: 32, heightSegments: 24 });
    const cellX = (i: number) => ((i % 3) - 1) * SPACING;
    const cellY = (i: number) => (0.5 - Math.floor(i / 3)) * SPACING;
    const sameHolesWithOrangeWhiteEdge = (base: BaseMaterial3D) => {
      const copy = base.clone({ extraBits: [dissolveBit] });

      copy.data.dissolve = 0.45;
      copy.data.dissolveEdgeColor = [6, 2, 0.4];

      return copy;
    };

    const basesInGridOrder = {
      Material3D: new Material3D({ baseColor: 0x4073e6, roughness: 0.5 }),
      'PhongMaterial, whose lighting runs after the extra bits, so an edge added before lighting vanishes':
        new PhongMaterial({ baseColor: 0x33b366 }),
      ToonMaterial: new ToonMaterial({ baseColor: 0x8a5cd6, outline: false }),
      'unlit FlatMaterial': new FlatMaterial({ baseColor: 0x3fa7d6 }),
      'blended Material3D': new Material3D({ baseColor: 0xd08030, roughness: 0.5, alpha: 0.5, alphaMode: 'blend' }),
    };

    Object.values(basesInGridOrder).forEach((base, i) => {
      const mesh = new Mesh3D({ geometry, material: sameHolesWithOrangeWhiteEdge(base) });

      mesh.position.set(cellX(i), cellY(i), 0);
      view.root.addChild(mesh);
    });

    const batched = new BatchedMesh3D({ size: 1 });

    batched.setGeometryAt(0, geometry);
    batched.setMaterialAt(0, sameHolesWithOrangeWhiteEdge(new Material3D({ baseColor: 0xc04060, roughness: 0.5 })));
    batched.setMatrixAt(0, new Matrix4().makeTranslation(cellX(5), cellY(5), 0));
    batched.setPassesAt(0, RenderPassBit.OPAQUE);
    view.root.addChild(batched);

    view.position.set(WIDTH / 2, HEIGHT / 2);
    app.stage.addChild(view);
  },
};
