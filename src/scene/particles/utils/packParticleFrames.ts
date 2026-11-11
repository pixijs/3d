import { warn } from 'pixi.js';
import type { Texture } from 'pixi.js';

const NO_PACKED_FRAMES = new Uint16Array(0);

/**
 * Packs each flipbook frame's window on its sheet, `(u0, v0, uScale, vScale)`, as the four
 * `unorm16` values a particle's `aParticleUVFrame` holds
 *
 * A single frame needs no window and gets an empty array. Rotated frames aren't supported.
 * @param textures - The flipbook frames, in frame order
 * @returns Four values per frame, or an empty array for a single frame
 * @throws If the frames don't all share one `TextureSource`.
 * @category scene
 * @advanced
 */
export function packParticleFrames(textures: readonly Texture[]): Uint16Array {
  if (textures.length <= 1) return NO_PACKED_FRAMES;

  const source = textures[0].source;

  for (let i = 1; i < textures.length; i++) {
    if (textures[i].source !== source) {
      throw new Error(
        '[ParticleContainer3D] Flipbook frames must all come from one texture source — a particle system ' +
          'draws in a single call and can only bind one texture. Pack the frames into a sprite sheet.',
      );
    }
  }

  const packedFrames = new Uint16Array(textures.length * 4);
  const sw = source.width;
  const sh = source.height;

  for (let i = 0; i < textures.length; i++) {
    const texture = textures[i];

    if (texture.rotate) {
      warn(
        `[ParticleContainer3D] Frame ${i} is rotated in its sprite sheet; particles sample axis-aligned ` +
          'frames only. Re-pack the sheet with rotation disabled.',
      );
    }

    const frame = texture.frame;
    const o = i * 4;

    packedFrames[o] = quantize(frame.x / sw);
    packedFrames[o + 1] = quantize(frame.y / sh);
    packedFrames[o + 2] = quantize(frame.width / sw);
    packedFrames[o + 3] = quantize(frame.height / sh);
  }

  return packedFrames;
}

function quantize(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 1) * 65535);
}
