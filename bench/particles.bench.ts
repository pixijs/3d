/**
 * `particles`: one emitter keeping N particles alive, each launched out of a small sphere and living 2.5 s under
 * gravity and drag while it shrinks and changes colour, blended additively (`blendMode: 'add'`), as effects ship. The
 * engine's own `ParticleSystem3D` runs it: the update steps the system, which spawns what is due, and the render draws
 * every live particle.
 *
 * Judged on `gpu.frame`, where drawing the particles lands; the spawning is `cpu.update`. The particles shrink as the
 * count grows, so the ladder is not a fill-rate test.
 */

import { ParticleSystem3D, SphereShape } from '@pixi/3d/extras';
import { frame } from 'benchy';
import { Ticker } from 'pixi.js';

import { particlesScene } from './data/particles.ts';
import { applyLook, displayColor } from './stage.ts';
import type { PixiStage } from './stage.ts';

frame('particles', {
  variants: { c10k: { count: 10_000 }, c100k: { count: 100_000 } },
  primary: 'gpu.frame',
  gate: 'strict',
  create(stage: PixiStage, { count }) {
    const data = particlesScene(count);
    applyLook(stage, data.look);
    const system = new ParticleSystem3D({
      capacity: data.count,
      blendMode: 'add',
      emitRate: data.count / data.life,
      shape: new SphereShape({ radius: data.radius }),
      life: data.life,
      speed: data.speed,
      size: data.size,
      sizeEnd: data.sizeEnd,
      color: displayColor(data.color),
      colorEnd: displayColor(data.colorEnd),
      gravity: data.gravity,
      drag: data.drag,
      seed: String(data.seed),
      autoUpdate: false,
    });
    stage.view.root.addChild(system);
    // A ticker of the bench's own, never started: it only carries the step into `update`.
    const step = new Ticker();
    // One life of 60 Hz steps fills the pool before the first frame, so the first frame drawn is already at the
    // steady count. Each step marks only the slots it spawned, so the whole pool is marked and uploaded once at the
    // end, whatever a backend keeps of the ranges marked before it.
    step.deltaMS = 1000 / 60;
    for (let steps = Math.ceil(data.life * 60); steps > 0; steps--) system.update(step);
    system.markDirty(0, data.count - 1);
    system.upload();
    return {
      update(dt) {
        step.deltaMS = dt * 1000;
        system.update(step);
      },
      destroy() {
        step.destroy();
      },
    };
  },
});
