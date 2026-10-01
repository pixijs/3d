import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { ParticleSystem3D } from '~/extras/particles/ParticleSystem3D';

/** Declared with `satisfies`, so `spawn()` knows these names and their shapes */
const windBit = {
  name: 'spawn-typing-wind',
  attributes: { aWind: 'float32x3', aSeed: 'float32' },
} satisfies ShaderBit;

function makeSystem(): ParticleSystem3D<readonly [typeof windBit]> {
  return new ParticleSystem3D({
    seed: 'test',
    autoUpdate: false,
    capacity: 8,
    emitRate: 0,
    life: 1,
    extraBits: [windBit] as const,
  });
}

/** Float `component` of an attribute on a slot's first vertex */
function laneAt(system: ParticleSystem3D<never>, index: number, name: string, component = 0): number {
  return system.data.f32[index * 4 * system.data.floatStride + system.data.offsets[name] / 4 + component];
}

/**
 * Typing cases tsc checks and nothing calls: a `@ts-expect-error` line still
 * executes if reached, and these would throw at runtime
 *
 * Custom and built-in overrides each take one value for the batch, a pair per
 * particle or a function per particle. `setParticle` takes the container's
 * built-ins, the system's own attributes and the custom ones. The bit list also
 * types `onUpdate`'s system, inferred from a plain array literal with no
 * `as const`.
 */
function tscOnlyChecks(): void {
  const system = makeSystem();

  system.spawn(1, { aWind: { x: 1, y: 2, z: 3 }, aSeed: 0.5 });
  system.spawn(1, {
    aWind: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    ],
    aSeed: [0, 1],
  });
  system.spawn(1, { aWind: (rng) => ({ x: rng(), y: 0, z: 0 }), aSeed: (_rng, index) => index });
  system.spawn(1, {
    life: [0.5, 2],
    size: (rng) => rng(),
    position: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ],
  });

  // @ts-expect-error a vec3 attribute does not take a number
  system.spawn(1, { aWind: 5 });
  // @ts-expect-error a scalar attribute does not take a point
  system.spawn(1, { aSeed: { x: 1 } });
  // @ts-expect-error nothing declared this name
  system.spawn(1, { aNope: 1 });

  system.setParticle(0, { aVel: { x: 0, y: 1, z: 0 }, aBirth: 0, aWind: { x: 1, y: 0, z: 0 } });
  // @ts-expect-error still shaped
  system.setParticle(0, { aWind: 1 });

  new ParticleSystem3D({
    extraBits: [windBit],
    onUpdate: (_dt, sys) => {
      sys.spawn(1, { aSeed: 1 });
      // @ts-expect-error typed through the callback
      sys.spawn(1, { aSeed: 'no' });
    },
  });
}

describe('ParticleSystem3D spawn overrides', () => {
  it('compiles the positive typing cases and rejects the negative ones', () => {
    expect(typeof tscOnlyChecks).toBe('function');
  });

  it('writes a custom attribute given as one value for the batch', () => {
    const system = makeSystem();

    system.spawn(3, { aWind: { x: 1, y: 2, z: 3 }, aSeed: 0.5 });

    for (let i = 0; i < 3; i++) {
      expect([laneAt(system, i, 'aWind'), laneAt(system, i, 'aWind', 1), laneAt(system, i, 'aWind', 2)]).toEqual([
        1, 2, 3,
      ]);
      expect(laneAt(system, i, 'aSeed')).toBe(0.5);
    }

    system.destroy();
  });

  it('draws each particle between a pair, per component for points', () => {
    const system = makeSystem();

    system.spawn(6, {
      aSeed: [10, 20],
      aWind: [
        { x: 0, y: 5, z: 0 },
        { x: 1, y: 5, z: 0 },
      ],
    });

    const seeds = Array.from({ length: 6 }, (_, i) => laneAt(system, i, 'aSeed'));

    for (const s of seeds) expect(s).toBeGreaterThanOrEqual(10);
    for (const s of seeds) expect(s).toBeLessThanOrEqual(20);
    expect(new Set(seeds).size).toBeGreaterThan(1);

    for (let i = 0; i < 6; i++) {
      expect(laneAt(system, i, 'aWind')).toBeGreaterThanOrEqual(0);
      expect(laneAt(system, i, 'aWind')).toBeLessThanOrEqual(1);
      expect(laneAt(system, i, 'aWind', 1), 'a degenerate pair is a constant').toBe(5);
    }

    system.destroy();
  });

  it('calls a function per particle with the seeded rng and the slot index', () => {
    const system = makeSystem();

    system.spawn(3, { aSeed: (_rng, index) => index * 10 });

    expect([laneAt(system, 0, 'aSeed'), laneAt(system, 1, 'aSeed'), laneAt(system, 2, 'aSeed')]).toEqual([0, 10, 20]);

    system.destroy();
  });

  it('resets a custom attribute to zero when a later spawn does not give it', () => {
    const system = makeSystem();

    system.spawn(1, { aWind: { x: 9, y: 9, z: 9 }, aSeed: 9 });
    system.spawn(1);

    expect(laneAt(system, 1, 'aWind')).toBe(0);
    expect(laneAt(system, 1, 'aSeed')).toBe(0);

    system.destroy();
  });
});
