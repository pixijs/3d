import type { TestScene } from '@test-utils';
import { Sprite } from 'pixi.js';

import type { SceneOutput } from '~/core/render-graph/SceneOutput';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import { ExtractPass } from '~/extras/scene-outputs/ExtractPass';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const normalOutputBit: ShaderBit = {
  name: 'sceneTestOutputNormal',
  outputs: { normal: 'vec4<f32>' },
  gpu: { fragment: { end: 'outputs.normal = vec4<f32>(normal * 0.5 + 0.5, 1.0);' } },
  gl: { fragment: { end: 'outputs.normal = vec4(normal * 0.5 + 0.5, 1.0);' } },
};

const albedoOutputBit: ShaderBit = {
  name: 'sceneTestOutputAlbedo',
  outputs: { albedo: 'vec4<f32>' },
  gpu: { fragment: { end: 'outputs.albedo = vec4<f32>(pow(albedo, vec3<f32>(1.0 / 2.2)), 1.0);' } },
  gl: { fragment: { end: 'outputs.albedo = vec4(pow(albedo, vec3(1.0 / 2.2)), 1.0);' } },
};

const depthOutputBit: ShaderBit = {
  name: 'sceneTestOutputDepth',
  outputs: { depth: 'vec4<f32>' },
  interStage: { vSceneTestDepth: 'f32' },
  gpu: {
    vertex: { end: 'output.vSceneTestDepth = -(camera.uViewMatrix * worldPosition).z;' },
    fragment: {
      end: 'outputs.depth = vec4<f32>(vec3<f32>(1.0 - clamp(input.vSceneTestDepth / 12.0, 0.0, 1.0)), 1.0);',
    },
  },
  gl: {
    vertex: { end: 'vSceneTestDepth = -(uViewMatrix * worldPosition).z;' },
    fragment: { end: 'outputs.depth = vec4(vec3(1.0 - clamp(vSceneTestDepth / 12.0, 0.0, 1.0)), 1.0);' },
  },
};

const outputs: SceneOutput[] = [
  { name: 'normal', format: 'rgba8unorm', bits: { opaque: normalOutputBit } },
  { name: 'albedo', format: 'rgba8unorm', bits: { opaque: albedoOutputBit } },
  { name: 'depth', format: 'rgba8unorm', bits: { opaque: depthOutputBit } },
];

export const scene: TestScene = {
  app: {
    width: 256,
    height: 256,
    backgroundColor: 0x000000,
  },
  create: async (app) => {
    const extracts = outputs.map((output) => new ExtractPass({ output }));
    const view = new View3D({
      width: 256,
      height: 128,
      environment: { skyColor: 0xdfe8f2, groundColor: 0x30281f },
      passes: extracts,
    });
    app.stage.addChild(view);

    view.camera.fov = 50;
    view.camera.position.set(0, 1.5, 6);
    view.camera.lookAt({ x: 0, y: 0, z: 0 });

    const floor = new Mesh3D({
      geometry: new PlaneGeometry({ width: 12, height: 12 }),
      material: new Material3D({ baseColor: 0x6b5d4f, roughness: 0.9 }),
    });
    floor.rotation.set(-Math.PI / 2, 0, 0);
    floor.position.set(0, -1, 0);
    view.root.addChild(floor);

    const sphere = new Mesh3D({
      geometry: new SphereGeometry({ radius: 0.8 }),
      material: new Material3D({ baseColor: 0xe0533d, roughness: 0.4 }),
    });
    sphere.position.set(-1.2, -0.2, 1);
    view.root.addChild(sphere);

    const cube = new Mesh3D({
      geometry: new CubeGeometry({ width: 1.5, height: 3, depth: 1.5 }),
      material: new Material3D({ baseColor: 0x4caf7a, roughness: 0.7 }),
    });
    cube.position.set(1.5, 0.5, -2);
    cube.rotation.set(0, 0.5, 0);
    view.root.addChild(cube);

    const pane = new Mesh3D({
      geometry: new PlaneGeometry({ width: 2, height: 1.5 }),
      material: new Material3D({ baseColor: 0x88ccff, alpha: 0.4, alphaMode: 'blend' }),
    });
    pane.position.set(-1.2, 0, 2.2);
    view.root.addChild(pane);

    for (let i = 0; i < extracts.length; i++) {
      const sprite = new Sprite(extracts[i].texture);
      sprite.scale.set(1 / 3);
      sprite.x = i * (256 / 3);
      sprite.y = 128 + 8;
      app.stage.addChild(sprite);
    }

    app.render();
  },
};
