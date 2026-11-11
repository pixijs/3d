import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';

const trajectoryBit = {
  name: 'typing-trajectory',
  attributes: { aVel: 'float32x3', aBirth: 'float32', aTint: 'unorm8x4' },
} satisfies ShaderBit;

const annotatedBit: ShaderBit = {
  name: 'typing-annotated',
  attributes: { aWind: 'float32x2' },
};

function typeOnly(): void {
  const typed = new ParticleContainer3D({ capacity: 1, extraBits: [trajectoryBit] });

  typed.setParticle(0, { aVel: { x: 1, y: 2, z: 3 }, aBirth: 0.5, aTint: { x: 1, y: 1, z: 1, w: 1 } });
  typed.setParticle(0, { aPosition: { x: 0, y: 0, z: 0 }, aParticleColor: 0xff0000 });

  // @ts-expect-error a vec3 attribute does not take a number
  typed.setParticle(0, { aVel: 5 });
  // @ts-expect-error a vec3 attribute does not take a vec2
  typed.setParticle(0, { aVel: { x: 1, y: 2 } });
  // @ts-expect-error a scalar attribute does not take a point
  typed.setParticle(0, { aBirth: { x: 1 } });
  // @ts-expect-error nothing declared this name
  typed.setParticle(0, { aNope: 1 });

  const permissive = new ParticleContainer3D({ capacity: 1, extraBits: [annotatedBit] });

  permissive.setParticle(0, { aWind: { x: 1, y: 2 }, aWhatever: 3 });

  const mixed = new ParticleContainer3D({ capacity: 1, extraBits: [trajectoryBit, annotatedBit] });

  mixed.setParticle(0, { aVel: { x: 1, y: 2, z: 3 }, aWind: { x: 0, y: 0 } });
  // @ts-expect-error aVel is still a vec3, not a number
  mixed.setParticle(0, { aVel: 5 });

  const bare = new ParticleContainer3D({ capacity: 1 });

  bare.setParticle(0, { aParticleSizeRot: { x: 1, y: 0 }, aAnything: 1 });
  // @ts-expect-error the built-ins keep their shapes even when the rest is open
  bare.setParticle(0, { aParticleSizeRot: 5 });
}

describe('ParticleContainer3D typing', () => {
  it('compiles the positive cases and rejects the negative ones under tsc', () => {
    expect(typeof typeOnly).toBe('function');
  });
});
