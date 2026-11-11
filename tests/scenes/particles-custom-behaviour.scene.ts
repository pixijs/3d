import type { TestScene } from '@test-utils';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PointShape } from '~/extras/particles/emitterShapes/PointShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { seededRandom } from '~/math/utils/seededRandom';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { puffTexture } from './helpers/particleTextures';

const sway = {
  name: 'scene-sway',
  attributes: { aSwayPhase: 'float32' },
  bindings: { material: { uSwayAmp: 'f32', uSwayFreq: 'f32' } },
  gpu: {
    vertex: {
      beforeTransform: /* wgsl */ `
  position.x += sin(particleAge * material.uSwayFreq + input.aSwayPhase) * material.uSwayAmp;
`,
    },
  },
  gl: {
    vertex: {
      beforeTransform: /* glsl */ `
  position.x += sin(particleAge * material.uSwayFreq + aSwayPhase) * material.uSwayAmp;
`,
    },
  },
} satisfies ShaderBit;

export const scene: TestScene = {
  create: async (app) => {
    const view3d = new View3D({ width: app.screen.width, height: app.screen.height });

    app.stage.addChild(view3d);

    view3d.camera.fov = 45;
    view3d.camera.position.set(0, 1.5, 9);
    view3d.camera.lookAt({ x: 0, y: 1.5, z: 0 });

    const wall = new Mesh3D({
      geometry: new PlaneGeometry({ width: 14, height: 10 }),
      material: new FlatMaterial({ baseColor: 0x2a2f3a }),
    });

    wall.position.set(0, 1.5, -2);
    view3d.root.addChild(wall);

    const system = new ParticleSystem3D({
      texture: puffTexture(),
      blendMode: 'add',
      capacity: 32,
      autoUpdate: false,
      emitRate: 0,
      createRandom: () => seededRandom('custom-behaviour'),
      shape: new PointShape(),
      life: 10,
      speed: 1.6,
      size: 0.55,
      color: 0x66ccff,
      extraBits: [sway],
    });

    system.position.set(0, -1.5, 0);
    system.uniforms.uSwayAmp = 1.2;
    system.uniforms.uSwayFreq = 2.4;
    view3d.root.addChild(system);

    for (let i = 0; i < 20; i++) {
      system.time = i * 0.15;
      system.spawn(1, { aSwayPhase: i % 2 === 0 ? 0 : Math.PI });
    }

    system.time = 3;
  },
};
