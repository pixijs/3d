import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { ShaderBit } from '~/core/shader/ShaderBit';
import { Material3D } from '~/materials/pbr/Material3D';
import { View3D } from '~/scene/View3D';

const makeView = () => new View3D({ width: 64, height: 64 });
const makeTexture = () => new Texture({ source: new TextureSource({ width: 1, height: 1 }) });

/**
 * Sequential shader slot of each texture name declared across `bits` —
 * mirrors texturesPluginGpu/Gl assignment (`shift = position * 4`). The
 * batcher packs nibble `t` from `material._textures[t]`, so for every
 * declared name: `slots[name]` must equal the texture's `_textures` index.
 */
function shaderSlots(bits: ShaderBit[]): Record<string, number> {
  const slots: Record<string, number> = {};
  let next = 0;
  for (const bit of bits) {
    for (const name of bit.textures ?? []) slots[name] = next++;
  }
  return slots;
}

describe('Material3D construction-locked feature bits (#73)', () => {
  it('keeps the descriptor and texture alignment when transmission is set to 0 at runtime', () => {
    const view = makeView();
    const transmissionTexture = makeTexture();
    const clearcoatTexture = makeTexture();
    const material = new Material3D({
      transmission: { factor: 0.5, texture: transmissionTexture },
      clearcoat: { factor: 0.5, texture: clearcoatTexture },
    });

    const before = material.getPrimaryDescriptor(view);
    const { keyGpu, keyGl } = before;

    let slots = shaderSlots(before.bitsGpu);
    expect(material._textures[slots.transmission]).toBe(transmissionTexture);
    expect(material._textures[slots.clearcoat]).toBe(clearcoatTexture);

    material.transmission!.factor = 0;

    // Same cached descriptor object — no variant rebuild on a value write.
    const after = material.getPrimaryDescriptor(view);
    expect(after).toBe(before);
    expect(after.keyGpu).toBe(keyGpu);
    expect(after.keyGl).toBe(keyGl);

    // transmissionBit stays in the descriptor, so every later feature's
    // shader slot still addresses the right `_textures` entry.
    slots = shaderSlots(after.bitsGpu);
    expect(material._textures[slots.transmission]).toBe(transmissionTexture);
    expect(material._textures[slots.clearcoat]).toBe(clearcoatTexture);
    expect(shaderSlots(after.bitsGl)).toEqual(slots);
  });

  it('keeps the descriptor and texture alignment when iridescenceFactor is set to 0 at runtime', () => {
    const view = makeView();
    const iridescenceTexture = makeTexture();
    const sheenColorTexture = makeTexture();
    const material = new Material3D({
      iridescence: { factor: 0.8, texture: iridescenceTexture },
      sheen: { color: 0xffffff, texture: sheenColorTexture },
    });

    const before = material.getPrimaryDescriptor(view);
    const { keyGpu, keyGl } = before;

    material.iridescence!.factor = 0;

    const after = material.getPrimaryDescriptor(view);
    expect(after).toBe(before);
    expect(after.keyGpu).toBe(keyGpu);
    expect(after.keyGl).toBe(keyGl);

    const slots = shaderSlots(after.bitsGpu);
    expect(material._textures[slots.iridescence]).toBe(iridescenceTexture);
    expect(material._textures[slots.sheen]).toBe(sheenColorTexture);
  });

  it('exposes no runtime path to a feature that was not constructed in', () => {
    const view = makeView();
    const material = new Material3D({});

    // No props objects exist for absent groups — the lock is structural.
    expect(material.transmission).toBeUndefined();
    expect(material.iridescence).toBeUndefined();

    const slots = shaderSlots(material.getPrimaryDescriptor(view).bitsGpu);
    expect(slots.transmission).toBeUndefined();
    expect(slots.iridescence).toBeUndefined();
  });
});
