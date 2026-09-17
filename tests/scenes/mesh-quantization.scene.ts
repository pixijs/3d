/**
 * Visual regression for KHR_mesh_quantization support.
 *
 * `duck-quantized/Duck.gltf` ships positions/normals/UVs as int16/int8 with
 * `KHR_mesh_quantization` declared. The snapshot should match the standard
 * (non-quantized) Duck within snapshot tolerance, exercising:
 *   - shader-side dequantization (`getPositionBit`)
 *   - VEC3→VEC4 padding inside `Geometry3D` for non-float vertex data
 *   - bounds computed from quantized integer positions
 */
import type { TestScene } from '@test-utils';
import { Assets, Container } from 'pixi.js';

import type { Scene3DSource } from '~/assets/Scene3DSource';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Model3D } from '~/scene/Model3D';
import { View3D } from '~/scene/View3D';

export const scene: TestScene = {
  assets: ['duck-quantized/Duck.gltf'],
  create: async (app, _context) => {
    const container = new Container();
    app.stage.addChild(container);

    const source = Assets.get<Scene3DSource>('duck-quantized/Duck.gltf');
    const model = new Model3D(source);
    model.position.y = -0.85;

    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    container.addChild(view3d);
    view3d.root.addChild(model);

    const light = new DirectionalLight({
      color: 0xffffff,
      intensity: 10,
    });

    view3d.root.addChild(light);

    const camera = view3d.camera;
    camera.position.set(0, 0, 3);
  },
};
