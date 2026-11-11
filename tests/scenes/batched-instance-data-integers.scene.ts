import type { TestScene } from '@test-utils';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { View3D } from '~/scene/View3D';

const COUNT = 8;

const integerBit: ShaderBit = {
  name: 'sceneInstanceIntegers',
  bindings: { instance: { packed: 'vec4<u32>', nudge: 'vec4<i32>' } },
  gpu: {
    vertex: { beforeTransform: 'position.y = position.y + f32(instance.nudge.y) * 0.6;' },
    fragment: { material: 'albedo = vec3<f32>(instance.packed.rgb);' },
  },
  gl: {
    vertex: { beforeTransform: 'position.y = position.y + float(instance.nudge.y) * 0.6;' },
    fragment: { material: 'albedo = vec3(instance.packed.rgb);' },
  },
};

export const scene: TestScene = {
  app: {
    backgroundColor: 0x14161a,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const cube = new CubeGeometry({ width: 0.8, height: 0.8, depth: 0.8 });
    const material = new FlatMaterial({ extraBits: [integerBit] });
    const m = new Matrix4();

    const cubes = new BatchedMesh3D({
      size: COUNT,
      instanceData: {
        packed: { value: [0, 0, 0, 0], type: 'vec4<u32>' },
        nudge: { value: [0, 0, 0, 0], type: 'vec4<i32>' },
      },
    });

    for (let i = 0; i < COUNT; i++) {
      const colour = (i % 7) + 1;

      cubes.setGeometryAt(i, cube);
      cubes.setMaterialAt(i, material);
      cubes.setMatrixAt(i, m.makeTranslation(i - (COUNT - 1) / 2, 0, 0));
      cubes.setPassesAt(i, RenderPassBit.OPAQUE);
      cubes.setInstanceDataAt(i, 'packed', (colour >> 2) & 1, (colour >> 1) & 1, colour & 1, 0);
      cubes.setInstanceDataAt(i, 'nudge', 0, i % 2 ? -1 : 1, 0, 0);
    }
    view3d.root.addChild(cubes);

    view3d.camera.position.set(0, 0, 9);
    view3d.camera.lookAt({ x: 0, y: 0, z: 0 });
  },
};
