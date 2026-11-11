/**
 * Particle spawn bursts, timed in Node. What a burst costs depends on which per-particle values it computes (the
 * built-in ranges, ramps over the life, or values the caller overrides) more than on the particle count, so each
 * variant is one of those patterns, judged against the built-ins. The patterns write different particles, so their
 * outputs differ by design. A burst is 1000 particles and a sample is one burst.
 *
 * With `autoUpdate: false` the system needs no document and no renderer, so a burst runs in Node, writing into the
 * container's own buffer with nothing to draw it.
 */

// The extras entry needs the core entry evaluated first; in Node, where this file runs, nothing else loads it before
// this file does.
import { seededRandom } from '@pixi/3d';
import { ParticleSystem3D, SphereShape } from '@pixi/3d/extras';
import type { ParticleSpawnOverrides } from '@pixi/3d/extras';
import { cpu } from 'benchy';

const BURST = 1000;

/** Bursts before the first sample, so the generated spawn function is warm and the pool has wrapped. */
const WARMUP_BURSTS = 10;

/**
 * Floats the snapshot keeps: the first two particles' worth of interleaved vertex data. A packed lane read through
 * the f32 view can come out as `NaN`, which is deterministic and compared exactly, so a change in the packing still
 * changes the snapshot.
 */
const SNAPSHOT_FLOATS = 12;

type Options = ConstructorParameters<typeof ParticleSystem3D>[0];

const BASE: Options = {
  createRandom: () => seededRandom('bench'),
  autoUpdate: false,
  emitRate: 0,
  capacity: 4096,
  life: [1, 2],
  speed: [3, 6],
  shape: new SphereShape({ radius: 0.2 }),
};

const RAMPS: Options = { ...BASE, sizeEnd: 0, alphaEnd: 0, colorEnd: 0xff_00_00, spin: [-1, 1] };

const OVERRIDES: ParticleSpawnOverrides = {
  position: { x: 1, y: 2, z: 3 },
  velocity: [
    { x: -5, y: -5, z: -5 },
    { x: 5, y: 5, z: 5 },
  ],
};

/**
 * What one burst writes, from a system of its own. The seeded stream advances with every particle, so what is in
 * the buffer depends on how many bursts came before it, which is what varies between blocks: a fresh system and a
 * single burst is the same reading every time.
 */
function firstBurst(options: Options, overrides?: ParticleSpawnOverrides): number[] {
  const probe = new ParticleSystem3D(options);
  probe.spawn(BURST, overrides);
  const floats = Array.from(probe.data.f32.subarray(0, SNAPSHOT_FLOATS));
  probe.destroy();
  return floats;
}

/** A burst: warm, then one burst a sample, and the system destroyed after the last one. */
cpu('burst of 1000', {
  variants: {
    builtins: { ramps: false, overrides: false },
    ramps: { ramps: true, overrides: false },
    overrides: { ramps: false, overrides: true },
  },
  output: 'differs',
  *run({ ramps, overrides }) {
    const options = ramps ? RAMPS : BASE;
    const values = overrides ? OVERRIDES : undefined;
    const subject = new ParticleSystem3D(options);
    for (let warm = 0; warm < WARMUP_BURSTS; warm++) subject.spawn(BURST, values);
    yield {
      bench: () => subject.spawn(BURST, values),
      snapshot: () => firstBurst(options, values),
    };
    // After the yield, which is teardown: a hook that ran per sample would destroy the system under the timed bursts.
    subject.destroy();
  },
});
