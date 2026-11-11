import type { TestScene } from '@test-utils';

import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  app: { backgroundColor: 0x101018 },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 50;
    view3d.camera.position.set(0, 0, 16);

    const geometries = [
      new CubeGeometry({ width: 1, height: 1, depth: 1 }),
      new SphereGeometry({ radius: 0.55 }),
      new CubeGeometry({ width: 0.6, height: 1.2, depth: 0.6 }),
    ];
    const materials = [new FlatMaterial({ baseColor: 0xe0533d }), new FlatMaterial({ baseColor: 0x3d7ae0 })];

    const makeCell = (col: number, row: number, x = col * 1.6 - 4, y = row * 1.6 - 2.4) => {
      const mesh = new Mesh3D({
        geometry: geometries[col % 3],
        material: materials[row % 2],
        castShadow: false,
        receiveShadow: false,
      });
      mesh.position.set(x, y, 0);
      return mesh;
    };

    const cells = Array.from({ length: 4 }, (_, row) => Array.from({ length: 6 }, (_, col) => makeCell(col, row)));
    view3d.root.addChild(...cells.flat());
    app.render();

    view3d.root.removeChild(cells[0][0], cells[0][1], cells[0][4], cells[2][1], cells[2][4]);
    app.render();

    view3d.root.addChild(cells[0][1]);
    view3d.root.addChild(makeCell(0, 0, 5.6, -0.8));

    view3d.root.removeChild(cells[1][2]);
    cells[1][2].destroy();
    view3d.root.addChild(makeCell(2, 1));

    view3d.root.removeChild(cells[1][3]);
    view3d.root.addChild(cells[1][3]);
  },
};
