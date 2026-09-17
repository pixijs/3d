import { warn } from 'pixi.js';
import type { Texture } from 'pixi.js';

const NO_PACKED_FRAMES = new Uint16Array(0);

/**
 * Quantizes each frame's sampling region into the vertex layout's `unorm16x4`
 * encoding
 *
 * `(u0, v0, uScale, vScale)` per frame in whole-source space, ready for
 * {@link ParticleContainer3D.writePacked | writePacked} to copy without
 * conversion. The sibling of {@link packParticleColor}: pixi objects in, GPU
 * bytes out, computed once.
 *
 * Returns an empty array for a single frame, whose vertices carry no frame
 * attribute at all — eight bytes saved on every streamed vertex; its framing rides
 * the material's `uvTransform` derivation instead. Multiple frames must share
 * one `TextureSource` (a sprite sheet), because a particle system is a single
 * draw call binding a single texture.
 * @param textures - The flipbook frames, in frame-index order
 * @returns Four `unorm16` values per frame, or an empty array for a single frame
 * @throws If the frames don't all share a source.
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
