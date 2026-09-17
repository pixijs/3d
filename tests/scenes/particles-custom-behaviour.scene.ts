import type { TestScene } from '@test-utils';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { PointShape } from '~/extras/particles/emitterShapes/PointShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';
import { PlaneGeometry } from '~/geometry/PlaneGeometry';
import { FlatMaterial } from '~/materials/flat/FlatMaterial';
import { Mesh3D } from '~/scene/Mesh3D';
import { View3D } from '~/scene/View3D';

import { puffTexture } from './helpers/particleTextures';

// The "write your own behaviour" path, end to end: a user bit declared with
// `satisfies ShaderBit`, composed into a ParticleSystem3D through extraBits,
// reading a uniform set through `system.uniforms`, a local the built-ins
// expose, and an attribute of its own written per particle by a spawn
// override. Particles are spawned at staggered clock values and the clock is
// then pinned, so the capture is one rising column bent into an S by the sway
// and split into two by the phase, with no stepping and no ticker involved.
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
      seed: 'custom-behaviour',
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

    // One particle every 0.15s of clock, then the clock pinned at 3s: ages run
    // from 3s down to 0.15s up the column. Every other particle sways in
    // antiphase, through the attribute the bit declared.
    for (let i = 0; i < 20; i++) {
      system.time = i * 0.15;
      system.spawn(1, { aSwayPhase: i % 2 === 0 ? 0 : Math.PI });
    }

    system.time = 3;
  },
};
