import type { TestScene } from '@test-utils';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { View3D } from '~/scene/View3D';

const SLOTS = 12;

export const scene: TestScene = {
  app: { backgroundColor: 0x101018 },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    view3d.camera.fov = 50;
    view3d.camera.position.set(0, 0, 12);

    const geometry = new CubeGeometry({ width: 0.9, height: 0.9, depth: 0.9 });
    const red = new FlatMaterial({ baseColor: 0xe0533d });
    const blue = new FlatMaterial({ baseColor: 0x3d7ae0 });

    const batched = new BatchedMesh3D({ size: SLOTS });
    const matrix = new Matrix4();
    for (let i = 0; i < SLOTS; i++) {
      batched.setGeometryAt(i, geometry);
      batched.setMaterialAt(i, i % 2 === 0 ? red : blue);
      batched.setMatrixAt(i, matrix.makeTranslation((i % 4) * 2 - 3, Math.floor(i / 4) * 2 - 2, 0));
      batched.setPassesAt(i, RenderPassBit.OPAQUE);
    }
    view3d.root.addChild(batched);
    app.render();

    blue.unload();
    for (let i = 0; i < SLOTS; i++) batched.invalidate(i);
    app.render();

    batched.setPassesAt(0, 0);
    batched.setPassesAt(1, 0);
    app.render();

    batched.setPassesAt(1, RenderPassBit.OPAQUE);
    batched.setMaterialAt(2, blue);
    batched.setVisibleAt(3, false);
  },
};
