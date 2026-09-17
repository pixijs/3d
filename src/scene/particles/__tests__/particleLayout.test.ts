import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';

function sheet(frames: number): Texture[] {
  const source = new TextureSource({ width: frames * 16, height: 16, resolution: 1 });

  return Array.from(
    { length: frames },
    (_, i) => new Texture({ source, frame: { x: i * 16, y: 0, width: 16, height: 16 } as never }),
  );
}

/** A bit that declares what it needs and does nothing with it — enough to grow the buffer */
const trajectoryBit: ShaderBit = {
  name: 'test-trajectory',
  attributes: { aVel: 'float32x3', aBirth: 'float32' },
  bindings: { material: { uWindStrength: 'f32' } },
};

describe('ParticleContainer3D layout', () => {
  it('derives the same layout the hard-coded offsets used to produce', () => {
    const plain = new ParticleContainer3D({ capacity: 4 });

    expect(plain.data.vertexStride).toBe(24);
    expect(plain.data.offsets).toEqual({
      aPosition: 0,
      aParticleSizeRot: 12,
      aParticleColor: 20,
    });

    const flipbook = new ParticleContainer3D({ capacity: 4, texture: sheet(2) });

    expect(flipbook.data.vertexStride).toBe(32);
    expect(flipbook.data.offsets.aParticleUVFrame).toBe(24);
  });

  it("grows the buffer from an extra bit's attribute declarations without moving a built-in attribute", () => {
    const particles = new ParticleContainer3D({ capacity: 4, extraBits: [trajectoryBit] });

    expect(particles.data.offsets).toEqual({
      aPosition: 0,
      aParticleSizeRot: 12,
      aParticleColor: 20,
      aVel: 24,
      aBirth: 36,
    });
    expect(particles.data.vertexStride).toBe(40);
  });

  it('keeps the corner id out of the interleaved buffer', () => {
    const particles = new ParticleContainer3D({ capacity: 4, extraBits: [trajectoryBit] });

    // Declared by uvsBit and streamed from its own buffer; never an interleaved attribute.
    expect(particles.data.offsets.aUV).toBeUndefined();
    expect(particles.geometry.attributes.aUV.stride).toBe(4);
  });

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

  it("exposes a bit's material bindings through uniforms", () => {
    const particles = new ParticleContainer3D({ capacity: 4, extraBits: [trajectoryBit] });

    particles.uniforms.uWindStrength = 2;

    expect(particles.uniforms.uWindStrength).toBe(2);
  });
});
