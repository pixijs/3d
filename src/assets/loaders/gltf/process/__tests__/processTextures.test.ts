import type { Texture, TextureStyle } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { GltfFormat } from '~/assets/loaders/gltf/GltfFormat';
import { processTextures } from '~/assets/loaders/gltf/process/processTextures';
import type { Scene3DSource } from '~/assets/Scene3DSource';

function fakeTexture(): Texture {
  return {
    source: {
      style: {} as TextureStyle,
      autoGenerateMipmaps: false,
    },
  } as unknown as Texture;
}

function run(sampler?: Partial<GltfFormat.Sampler>): Texture {
  const texture = fakeTexture();
  const gltfRaw = {
    textures: [{ source: 0, sampler: sampler ? 0 : undefined }],
    samplers: sampler ? [sampler] : undefined,
  } as unknown as GltfFormat;

  const source = { textures: [], texture: {} } as unknown as Scene3DSource;
  processTextures(gltfRaw, [texture], source);

  return texture;
}

describe('processTextures — mipmap defaults', () => {
  it('enables mips when there is no sampler', () => {
    expect(run().source.autoGenerateMipmaps).toBe(true);
  });

  it('disables mips for an explicit non-mipmap minFilter (9728 NEAREST)', () => {
    expect(run({ minFilter: 9728 }).source.autoGenerateMipmaps).toBe(false);
  });

  it('disables mips for an explicit non-mipmap minFilter (9729 LINEAR)', () => {
    expect(run({ minFilter: 9729 }).source.autoGenerateMipmaps).toBe(false);
  });
});

describe('processTextures: sampler defaults', () => {
  it('gives a texture with no sampler glTF’s repeat wrapping and linear filtering', () => {
    expect(run().source.style).toMatchObject({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
    });
  });

  it('fills the fields a sampler leaves out from glTF’s defaults', () => {
    expect(run({ magFilter: 9728 }).source.style).toMatchObject({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'nearest',
      minFilter: 'linear',
    });
  });
});
