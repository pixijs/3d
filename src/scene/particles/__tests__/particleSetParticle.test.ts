import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { ParticleContainer3D } from '~/scene/particles/ParticleContainer3D';
import { packParticleColor } from '~/scene/particles/utils/packParticleColor';

function sheet(frames: number): Texture[] {
  const source = new TextureSource({ width: frames * 16, height: 16, resolution: 1 });

  return Array.from(
    { length: frames },
    (_, i) => new Texture({ source, frame: { x: i * 16, y: 0, width: 16, height: 16 } as never }),
  );
}

const trajectoryBit: ShaderBit = {
  name: 'test-trajectory',
  attributes: { aVel: 'float32x3', aBirth: 'float32', aTint: 'unorm8x4' },
};

function vertex(particles: ParticleContainer3D, i: number, v: number): number {
  return (i * 4 + v) * particles.data.floatStride;
}

describe('ParticleContainer3D.setParticle', () => {
  it("writes a bit's vector attribute into all four vertices", () => {
    const particles = new ParticleContainer3D({ capacity: 4, extraBits: [trajectoryBit] });
    const { f32, offsets } = particles.data;

    particles.setParticle(2, { aVel: { x: 1, y: 2, z: 3 } });

    for (let v = 0; v < 4; v++) {
      const o = vertex(particles, 2, v) + offsets.aVel / 4;

      expect([f32[o], f32[o + 1], f32[o + 2]]).toEqual([1, 2, 3]);
    }
  });

  it('writes a scalar attribute and leaves attributes it was not given untouched', () => {
    const particles = new ParticleContainer3D({ capacity: 4, extraBits: [trajectoryBit] });
    const { f32, offsets } = particles.data;

    particles.setParticle(1, { aVel: { x: 9, y: 9, z: 9 } });
    particles.setParticle(1, { aBirth: 0.75 });

    const o = vertex(particles, 1, 0);

    expect(f32[o + offsets.aBirth / 4]).toBe(0.75);
    expect(f32[o + offsets.aVel / 4]).toBe(9);
  });

  it('addresses the built-in attributes by their attribute names', () => {
    const particles = new ParticleContainer3D({ capacity: 4 });
    const { f32 } = particles.data;

    particles.setParticle(0, { aPosition: { x: 4, y: 5, z: 6 }, aParticleSizeRot: { x: 0.5, y: 0.25 } });

    const o = vertex(particles, 0, 3);

    expect([f32[o], f32[o + 1], f32[o + 2]]).toEqual([4, 5, 6]);
    expect([f32[o + 3], f32[o + 4]]).toEqual([0.5, 0.25]);
  });

  it('packs the built-in tint from any ColorSource as authored, matching setParticleAt', () => {
    const particles = new ParticleContainer3D({ capacity: 4 });
    const { u32, offsets } = particles.data;

    particles.setParticle(0, { aParticleColor: 0xff8040 });
    particles.setParticle(1, { aParticleColor: 'red' });
    particles.setParticle(2, { aParticleColor: { r: 255, g: 128, b: 64, a: 0.5 } });

    const tint = offsets.aParticleColor / 4;

    expect(u32[vertex(particles, 0, 0) + tint]).toBe(packParticleColor(0xff8040, 1));
    expect(u32[vertex(particles, 1, 0) + tint]).toBe(packParticleColor(0xff0000, 1));
    expect(u32[vertex(particles, 2, 0) + tint]).toBe(packParticleColor(0xff8040, 0.5));
  });

  it('clamps a packed value to its range instead of spilling into the next channel', () => {
    const particles = new ParticleContainer3D({ capacity: 4, texture: sheet(2), extraBits: [trajectoryBit] });
    const { u32, u16, offsets } = particles.data;

    particles.setParticle(0, { aTint: { x: 1.5, y: -0.5, z: 0.5, w: 2 } });
    particles.setParticle(0, { aParticleUVFrame: { x: 1.0001, y: -0.0001, z: 0.5, w: 7 } });

    const packed = u32[vertex(particles, 0, 0) + offsets.aTint / 4];
    const h = (vertex(particles, 0, 0) + offsets.aParticleUVFrame / 4) * 2;

    expect([packed & 0xff, (packed >>> 8) & 0xff, (packed >>> 16) & 0xff, packed >>> 24]).toEqual([255, 0, 128, 255]);
    expect([u16[h], u16[h + 1], u16[h + 2], u16[h + 3]]).toEqual([65535, 0, 32768, 65535]);
  });

  it('skips a key given as undefined, like one left out', () => {
    const particles = new ParticleContainer3D({ capacity: 4, extraBits: [trajectoryBit] });
    const { f32, offsets } = particles.data;

    particles.setParticle(1, { aBirth: 0.75 });
    particles.setParticle(1, { aBirth: undefined as never, aVel: { x: 1, y: 1, z: 1 } });

    expect(f32[vertex(particles, 1, 0) + offsets.aBirth / 4]).toBe(0.75);
  });

  it('refuses an attribute nothing declared, naming what is available', () => {
    const particles = new ParticleContainer3D({ capacity: 4, extraBits: [trajectoryBit] });

    expect(() => particles.setParticle(0, { aNope: 1 })).toThrow(/no attribute 'aNope'.*aVel/);
  });

  it('refuses a value of the wrong shape for its attribute', () => {
    const particles = new ParticleContainer3D({ capacity: 4, extraBits: [trajectoryBit] });

    expect(() => particles.setParticle(0, { aVel: { x: 1, y: 2 } })).toThrow(/'aVel' takes \{ x, y, z \}/);
    expect(() => particles.setParticle(0, { aBirth: { x: 1 } as never })).toThrow(/'aBirth' takes a number/);
  });
});
