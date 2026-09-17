import type { SCALE_MODE, Texture, WRAP_MODE } from 'pixi.js';

import type { Scene3DSource } from '../../../Scene3DSource';
import type { GltfFormat } from '../GltfFormat';

/**
 * Applies glTF sampler state to the loaded textures and stores them on the source
 * @param gltfRaw - Parsed glTF JSON
 * @param images - Loaded textures indexed by glTF image index
 * @param source - Receives the textures
 * @internal
 */
export function processTextures(gltfRaw: GltfFormat, images: Texture[], source: Scene3DSource): void {
  if (gltfRaw.textures) {
    gltfRaw.textures.forEach((rawTexture, index) => {
      const texture = images[rawTexture.source!];

      const sampler = gltfRaw.samplers?.[rawTexture.sampler!];

      if (sampler) {
        const style = texture.source.style;

        style.addressModeU = sampler.wrapS ? getWrapMode(sampler.wrapS) : 'repeat';
        style.addressModeV = sampler.wrapT ? getWrapMode(sampler.wrapT) : 'repeat';
        style.magFilter = sampler.magFilter ? getMagFilter(sampler.magFilter) : 'linear';
        style.minFilter = sampler.minFilter ? getMinFilter(sampler.minFilter) : 'linear';
      }

      // Material textures default to a full mip pyramid (anti-aliasing at oblique
      // angles / distance, and the prerequisite for anisotropic filtering). This is
      // the right default for 3D unlike Pixi 2D's mips-off sprite default. Set before
      // the first GPU upload, so no re-upload cost. Only an explicit non-mipmap glTF
      // sampler minFilter (NEAREST/LINEAR) opts a texture out — e.g. pixel art.
      texture.source.autoGenerateMipmaps = wantsMipmaps(sampler?.minFilter);

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

/**
 * Whether a texture should generate mips, derived from the glTF sampler `minFilter`
 *
 * On by default (undefined sampler / undefined minFilter / any `*_MIPMAP_*` mode);
 * off only for an explicit non-mipmap minFilter — `9728` NEAREST or `9729` LINEAR.
 * @param minFilter - The sampler's `minFilter` GL enum, when the texture has one
 */
function wantsMipmaps(minFilter?: number): boolean {
  return minFilter !== 9728 && minFilter !== 9729;
}
