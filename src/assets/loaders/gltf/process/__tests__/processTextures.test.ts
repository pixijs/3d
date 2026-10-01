import type { Texture, TextureStyle } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { GltfFormat, Sampler } from '~/assets/loaders/gltf/GltfFormat';
import { processTextures } from '~/assets/loaders/gltf/process/processTextures';
import type { Scene3DSource } from '~/assets/Scene3DSource';

/** Minimal texture stand-in — `processTextures` only touches `source.style`/`source.autoGenerateMipmaps`. */
function fakeTexture(): Texture {
  return {
    source: {
      style: {} as TextureStyle,
      autoGenerateMipmaps: false,
    },
  } as unknown as Texture;
}

/** Run `processTextures` for a single image/texture against the given sampler (if any). */
function run(sampler?: Partial<Sampler>): Texture {
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

  it('enables mips for a mipmap minFilter (9987 LINEAR_MIPMAP_LINEAR)', () => {
    expect(run({ minFilter: 9987 }).source.autoGenerateMipmaps).toBe(true);
  });

  it('disables mips for an explicit non-mipmap minFilter (9728 NEAREST)', () => {
    expect(run({ minFilter: 9728 }).source.autoGenerateMipmaps).toBe(false);
  });

  it('disables mips for an explicit non-mipmap minFilter (9729 LINEAR)', () => {
    expect(run({ minFilter: 9729 }).source.autoGenerateMipmaps).toBe(false);
  });
});
