import type { TestScene } from '@test-utils';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { OutlinePass } from '~/extras/post-processing/passes/OutlinePass';
import { SphereGeometry } from '~/geometry/SphereGeometry';
import { Material3D } from '~/materials/pbr/Material3D';
import type { Material3DData } from '~/materials/pbr/Material3D';
import { AmbientLight } from '~/scene/lights/AmbientLight';
import { DirectionalLight } from '~/scene/lights/DirectionalLight';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

const outlineInkBit: ShaderBit = {
  name: 'sceneOutlineInk',
  bindings: { material: { outlineWidth: 'f32', outlineInk: 'vec3<f32>' } },
  gpu: {
    vertex: { beforeTransform: 'position = vec4<f32>(position.xyz + normalize(normal) * material.outlineWidth, 1.0);' },
    fragment: { end: 'finalColor = material.outlineInk;' },
  },
  gl: {
    vertex: { beforeTransform: 'position.xyz += normalize(normal) * material.outlineWidth;' },
    fragment: { end: 'finalColor = material.outlineInk;' },
  },
};

const rippleBit: ShaderBit = {
  name: 'sceneOutlineRipple',
  level: 'shape',
  gpu: {
    vertex: {
      beforeTransform: 'position = vec4<f32>(position.xyz + normalize(normal) * 0.12 * sin(position.y * 14.0), 1.0);',
    },
  },
  gl: { vertex: { beforeTransform: 'position.xyz += normalize(normal) * 0.12 * sin(position.y * 14.0);' } },
};

interface OutlineInkData {
  outlineWidth: number;
  outlineInk: Float32Array;
}

export const scene: TestScene = {
  app: {
    width: 340,
    height: 260,
    backgroundColor: 0xe8eef4,
  },
  delay: 120,
  create: async (app) => {
    const view = new View3D({
      width: 320,
      height: 220,
      anchor: 0.5,
      toneMapping: 'none',
      environment: { skyColor: 0xffffff, groundColor: 0x334455 },
      passes: [new OutlinePass({ width: 0.03, color: 0x1a0f33 })],
    });
    view.camera.fov = 40;
    view.camera.position.set(0, 1.4, 5.4);
    view.camera.lookAt({ x: 0, y: 0.1, z: 0 });

    view.root.addChild(new AmbientLight({ color: 0xffffff, intensity: 0.4 }));
    const key = new DirectionalLight({ color: 0xffffff, intensity: 3 });
    key.position.set(3, 5, 4);
    key.lookAt({ x: 0, y: 0, z: 0 });
    view.root.addChild(key);

    const plain = new Material3D({ baseColor: 0x4488ff, roughness: 0.55, passes: { outline: true } });

    const inked = new Material3D({
      baseColor: 0xff7733,
      roughness: 0.55,
      passes: { outline: { extraBits: [outlineInkBit] } },
    });
    const inkedData = inked.data as Material3DData & OutlineInkData;
    inkedData.outlineWidth = 0.09;
    inkedData.outlineInk.set([0.85, 0.1, 0.2]);

    const rippled = new Material3D({
      baseColor: 0x55cc77,
      roughness: 0.55,
      extraBits: [rippleBit],
      passes: { outline: true },
    });

    const left = new Mesh3D({ geometry: new SphereGeometry({ radius: 0.7 }), material: plain });
    left.position.set(-1.7, 0.1, 0);
    view.root.addChild(left);

    const middle = new Mesh3D({ geometry: new SphereGeometry({ radius: 0.6 }), material: inked });
    middle.position.set(0, 0.1, 0);
    view.root.addChild(middle);

    const right = new Mesh3D({ geometry: new SphereGeometry({ radius: 0.65 }), material: rippled });
    right.position.set(1.7, 0.1, 0);
    view.root.addChild(right);

    view.position.set(170, 130);
    app.stage.addChild(view);
  },
};
