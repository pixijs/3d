import type { TestScene } from '@test-utils';
import { State } from 'pixi.js';

import type { ShaderDescriptorOptions } from '~/core/shader/ShaderDescriptor';
import { solidMeshDescriptor } from '~/extras/post-processing/passes/solidMeshShader';
import { CubeGeometry } from '~/geometry/CubeGeometry';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import { MeshPass } from '~/post-processing/passes/MeshPass';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const SIZE = 220;

export function stateChangeScene(shaderDescriptor: ShaderDescriptorOptions): TestScene {
  return {
    app: {
      width: 340,
      height: 260,
      backgroundColor: 0xe8eef4,
    },
    delay: 120,
    create: async (app) => {
      const state = new State();
      state.depthTest = true;
      state.culling = true;
      state.blend = false;

      const view = new View3D({
        width: 320,
        height: SIZE,
        anchor: 0.5,
        toneMapping: 'none',
        environment: { skyColor: 0xffffff, groundColor: 0x334455 },
        passes: [new MeshPass({ name: 'state-change-xray', descriptor: { shaderDescriptor, state } })],
      });
      view.camera.fov = 40;
      view.camera.position.set(0, 1.4, 5.4);
      view.camera.lookAt({ x: 0, y: 0.1, z: 0 });

      view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.4 }));
      const key = new DirectionalLight({ color: 0xffffff, intensity: 3 });
      key.position.set(3, 5, 4);
      key.lookAt({ x: 0, y: 0, z: 0 });
      view.root.addChild(key);

      const wall = new Mesh3D({
        geometry: new CubeGeometry({ width: 4, height: 2.4, depth: 0.2 }),
        material: new Material3D({ baseColor: 0x4488ff, roughness: 0.55 }),
      });
      wall.position.set(0, 0.1, 0.8);
      view.root.addChild(wall);

      const geometry = new SphereGeometry({ radius: 0.5 });
      const material = new Material3D({ baseColor: 0xff7733, passes: { 'state-change-xray': true } });
      const hidden = [-0.8, 0.8].map((x) => {
        const mesh = new Mesh3D({ geometry, material });
        mesh.position.set(x, 0.1, -0.4);
        return mesh;
      });
      view.root.addChild(...hidden);

      view.position.set(170, 130);
      app.stage.addChild(view);
      app.render();

      state.depthTest = false;
      for (const mesh of hidden) mesh.invalidate();
    },
  };
}

export const scene = stateChangeScene(solidMeshDescriptor({ color: 0xd81b60 }));
