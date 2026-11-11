import type { TestScene } from '@test-utils';

import { RenderPassBit } from '~/core/render-passes/RenderPass';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Matrix4 } from '~/math/matrix/Matrix4';
import { BatchedMesh3D } from '~/scene/BatchedMesh3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { View3D } from '~/scene/View3D';

const COLUMNS = 6;
const ROWS = 4;

const columnBit: ShaderBit = {
  name: 'sceneInstanceColumn',
  bindings: { instance: { shape: 'vec4<f32>', tint: 'vec4<f32>' } },
  gpu: {
    vertex: {
      beforeTransform: 'position = vec4<f32>(position.x, (position.y + 0.5) * instance.shape.x, position.z, 1.0);',
    },
    fragment: { material: 'albedo *= instance.tint.rgb;' },
  },
  gl: {
    vertex: {
      beforeTransform: 'position = vec4(position.x, (position.y + 0.5) * instance.shape.x, position.z, 1.0);',
    },
    fragment: { material: 'albedo *= instance.tint.rgb;' },
  },
};

export const scene: TestScene = {
  app: {
    backgroundColor: 0x14161a,
  },
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });
    app.stage.addChild(view3d);

    const cube = new CubeGeometry({ width: 0.8, height: 1, depth: 0.8 });
    const material = new Material3D({ baseColor: 0xffffff, metallic: 0, roughness: 0.6, extraBits: [columnBit] });
    const m = new Matrix4();

    const columns = new BatchedMesh3D({
      size: COLUMNS * ROWS,
      instanceData: {
        shape: { value: [0.4, 0, 0, 0], type: 'vec4<f32>' },
        tint: { value: [0.5, 0.5, 0.5, 1], type: 'vec4<f32>' },
      },
    });

    for (let i = 0; i < columns.size; i++) {
      const column = i % COLUMNS;
      const row = Math.floor(i / COLUMNS);

      columns.setGeometryAt(i, cube);
      columns.setMaterialAt(i, material);
      columns.setMatrixAt(i, m.makeTranslation(column - (COLUMNS - 1) / 2, 0, (ROWS - 1) / 2 - row));
      columns.setPassesAt(i, RenderPassBit.OPAQUE);

      if (i === 0) continue;

      const hue = row / (ROWS - 1);
      columns.setInstanceDataAt(i, 'shape', 0.5 + column * 0.45, 0, 0, 0);
      columns.setInstanceDataAt(i, 'tint', 1 - hue * 0.9, 0.12 + hue * 0.2, 0.08 + hue * 0.9, 1);
    }
    view3d.root.addChild(columns);

    const plainMaterial = new Material3D({ baseColor: 0x2e9c5a, metallic: 0, roughness: 0.6 });
    const plain = new BatchedMesh3D({ size: COLUMNS });
    for (let i = 0; i < plain.size; i++) {
      plain.setGeometryAt(i, cube);
      plain.setMaterialAt(i, plainMaterial);
      plain.setMatrixAt(i, m.makeTranslation(i - (COLUMNS - 1) / 2, 0.5, -(ROWS + 1) / 2));
      plain.setPassesAt(i, RenderPassBit.OPAQUE);
    }
    view3d.root.addChild(plain);

    const light = new DirectionalLight({ color: 0xffffff, intensity: 2 });
    light.rotation.set(-0.9, 0.6, 0.2);
    view3d.root.addChild(light, new AmbientLight({ color: 0xffffff, intensity: 0.2 }));

    view3d.camera.position.set(-5, 6, 7);
    view3d.camera.lookAt({ x: 0.3, y: 0.9, z: -0.6 });
  },
};
