import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';

const trajectoryBit: ShaderBit = {
  name: 'test-trajectory',
  attributes: { aVel: 'float32x3', aBirth: 'float32' },
  bindings: { material: { uWindStrength: 'f32' } },
};

describe('ParticleContainer3D layout', () => {
  it('keeps writing the built-in attributes correctly once a bit widens the vertex', () => {
    const particles = new ParticleContainer3D({ capacity: 4, extraBits: [trajectoryBit] });
    const { f32, floatStride } = particles.data;

    expect(floatStride).toBe(10);

    particles.setParticleAt(1, 1, 2, 3, 0.5, 0.25);

    const o = 1 * 4 * floatStride;

    expect([f32[o], f32[o + 1], f32[o + 2]]).toEqual([1, 2, 3]);
    expect(f32[o + 3]).toBe(0.5);
    expect(f32[o + 4]).toBe(0.25);
  });
});
