import { CompressedSource } from 'pixi.js';
import type { SCALE_MODE, Texture, WRAP_MODE } from 'pixi.js';

import type { Scene3DSource } from '../../../Scene3DSource';
import type { GltfFormat } from '../GltfFormat';

/** The glTF default sampler, written to every texture, since pixi's own default clamps to the edge */
const DEFAULT_SAMPLER: Required<Pick<GltfFormat.Sampler, 'wrapS' | 'wrapT' | 'magFilter' | 'minFilter'>> = {
  wrapS: 10497,
  wrapT: 10497,
  magFilter: 9729,
  minFilter: 9987,
};

/**
 * A `CompressedSource` keeps the mips it shipped with, as the GPU can't generate them
 * @internal
 */
export function processTextures(gltfRaw: GltfFormat, images: Texture[], source: Scene3DSource): void {
  if (gltfRaw.textures) {
    gltfRaw.textures.forEach((rawTexture, index) => {
      const texture = images[rawTexture.source!];

      const sampler = { ...DEFAULT_SAMPLER, ...gltfRaw.samplers?.[rawTexture.sampler!] };

      const style = texture.source.style;

      style.addressModeU = getWrapMode(sampler.wrapS);
      style.addressModeV = getWrapMode(sampler.wrapT);
      style.magFilter = getMagFilter(sampler.magFilter);
      style.minFilter = getMinFilter(sampler.minFilter);

      texture.source.autoGenerateMipmaps =
        !(texture.source instanceof CompressedSource) && wantsMipmaps(sampler.minFilter);

      source.textures[index] = texture;

      if (rawTexture.name) {
        source.texture[rawTexture.name] = texture;
      }
    });
  }
}

function getWrapMode(mode: number): WRAP_MODE {
  switch (mode) {
    case 33071:
      return 'clamp-to-edge';
    case 33648:
      return 'mirror-repeat';
    case 10497:
      return 'repeat';
    default:
      return 'repeat';
  }
}

function getMagFilter(mode: number): SCALE_MODE {
  return mode === 9728 ? 'nearest' : 'linear';
}

function getMinFilter(mode: number): SCALE_MODE {
  if (mode === 9728 || mode === 9984 || mode === 9986) {
    return 'nearest';
  }
  return 'linear';
}

function wantsMipmaps(minFilter: number): boolean {
  return minFilter !== 9728 && minFilter !== 9729;
}
