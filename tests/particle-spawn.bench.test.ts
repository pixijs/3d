import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { SphereShape } from '~/extras/particles/emitterShapes/SphereShape';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';

// How long does a 1000-particle burst take through spawn()? Opt-in:
//   VITE_PARTICLE_BENCH=1 npx vitest run particle-spawn.bench --browser.headless
// Numbers print per variant as a median of 200 samples of ten bursts each.
// performance.now() is about 100 µs coarse; ten thousand spawns a sample turn
// that into 10 ns per particle.
//
// Desktop Chromium, 2026-09-04, ns per particle:
//
//   built-ins only, no overrides                   70
//     unseeded (random seed)                       80
//     PointShape instead of Sphere                 50
//     space: 'local' (no transform bake)           80
//     every spread a single value                  90
//   built-ins + ramps + spin, no overrides        100
//   explosion: position + velocity pair override  100
//   custom bit, value + pair overrides            100
//
// A burst runs the spawn function generated for its override pattern, so
// what remains is the inherent per-particle work: a random point on the
// shape, the RNG draws, the world-transform bake and the four-vertex stores.
// A thousand-particle burst is 0.05 to 0.1 ms.
const windBit = { name: 'bench-wind', attributes: { aWind: 'float32x3', aSeed: 'float32' } } satisfies ShaderBit;

/** Every variant's median, so the test can assert each burst took finite time */
const MEDIANS: number[] = [];

function bench(label: string, make: () => ParticleSystem3D<never>, overrides?: Record<string, unknown>): void {
  const system = make();
  const BURST = 1000;
  const ROUNDS = 200;

  for (let i = 0; i < 10; i++) system.spawn(BURST, overrides as never);

  const times: number[] = [];

  for (let r = 0; r < ROUNDS; r++) {
    const t0 = performance.now();

    for (let b = 0; b < 10; b++) system.spawn(BURST, overrides as never);
    times.push((performance.now() - t0) / 10);
  }

  times.sort((a, b) => a - b);

  const median = times[ROUNDS >> 1];

  MEDIANS.push(median);

  // eslint-disable-next-line no-console
  console.log(
    `${label.padEnd(44)} ${median.toFixed(3).padStart(7)} ms / 1000 spawns  = ${((median * 1e6) / BURST).toFixed(0).padStart(4)} ns each`,
  );
  system.destroy();
}

describe('spawn burst cost', () => {
  it.runIf(import.meta.env.VITE_PARTICLE_BENCH)('measures', () => {
    const base = () =>
      new ParticleSystem3D({
        seed: 'bench',
        autoUpdate: false,
        emitRate: 0,
        capacity: 4096,
        life: [1, 2],
        speed: [3, 6],
        shape: new SphereShape({ radius: 0.2 }),
      });

    bench('built-ins only, no overrides', base);
    bench('  … unseeded (random seed)', () =>
      new ParticleSystem3D({
        autoUpdate: false,
        emitRate: 0,
        capacity: 4096,
        life: [1, 2],
        speed: [3, 6],
        shape: new SphereShape({ radius: 0.2 }),
      }));
    bench('  … PointShape instead of Sphere', () =>
      new ParticleSystem3D({
        seed: 'bench',
        autoUpdate: false,
        emitRate: 0,
        capacity: 4096,
        life: [1, 2],
        speed: [3, 6],
      }));
    bench("  … space: 'local' (no transform bake)", () =>
      new ParticleSystem3D({
        seed: 'bench',
        autoUpdate: false,
        emitRate: 0,
        capacity: 4096,
        life: [1, 2],
        speed: [3, 6],
        space: 'local',
        shape: new SphereShape({ radius: 0.2 }),
      }));
    bench('  … every spread a single value', () =>
      new ParticleSystem3D({
        seed: 'bench',
        autoUpdate: false,
        emitRate: 0,
        capacity: 4096,
        life: 1,
        speed: 3,
        shape: new SphereShape({ radius: 0.2 }),
      }));
    bench('built-ins + ramps + spin, no overrides', () =>
      new ParticleSystem3D({
        seed: 'bench',
        autoUpdate: false,
        emitRate: 0,
        capacity: 4096,
        life: [1, 2],
        speed: [3, 6],
        sizeEnd: 0,
        alphaEnd: 0,
        colorEnd: 0xff0000,
        spin: [-1, 1],
        shape: new SphereShape({ radius: 0.2 }),
      }));
    bench('explosion: position + velocity pair override', base, {
      position: { x: 1, y: 2, z: 3 },
      velocity: [
        { x: -5, y: -5, z: -5 },
        { x: 5, y: 5, z: 5 },
      ],
    });
    bench(
      'custom bit, value + pair overrides',
      () =>
        new ParticleSystem3D({
          seed: 'bench',
          autoUpdate: false,
          emitRate: 0,
          capacity: 4096,
          life: [1, 2],
          extraBits: [windBit],
          shape: new SphereShape({ radius: 0.2 }),
        }) as ParticleSystem3D<never>,
      { aWind: { x: 1, y: 0, z: 0 }, aSeed: [0, 1] },
    );

    for (const median of MEDIANS) expect(median).toBeGreaterThan(0);
  });
});
