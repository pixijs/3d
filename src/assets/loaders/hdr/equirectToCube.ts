import { CompressedSource, CubeTexture } from 'pixi.js';

import { RG11B10_MAX } from '../../../core/ibl/generateIblSpecialCubemap';
import type { RadianceImage } from './parseRadianceHdr';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Negative values and NaN give 0, values past `RG11B10_MAX` clamp, and values under 2⁻¹⁴ flush to 0 */
function toUfloat(value: number, mantissaBits: number): number {
  if (!(value > 0)) return 0;
  f32[0] = Math.min(value, RG11B10_MAX);
  const bits = u32[0];
  const exponent = ((bits >>> 23) & 0xff) - 112;
  if (exponent <= 0) return 0;
  const shift = 23 - mantissaBits;
  return ((exponent << mantissaBits) | ((bits >>> shift) & ((1 << mantissaBits) - 1))) + ((bits >>> (shift - 1)) & 1);
}

/**
 * Follows the cube-map face table GPU APIs share, `s` and `t` running -1 to 1 from the top-left
 * @param face - In pixi's order: +X, -X, +Y, -Y, +Z, -Z
 * @param s - Across the face
 * @param t - Down the face
 * @param out - Receives the unnormalised direction
 */
function faceDirection(face: number, s: number, t: number, out: Float64Array): void {
  switch (face) {
    case 0:
      out[0] = 1;
      out[1] = -t;
      out[2] = -s;
      break;
    case 1:
      out[0] = -1;
      out[1] = -t;
      out[2] = s;
      break;
    case 2:
      out[0] = s;
      out[1] = 1;
      out[2] = t;
      break;
    case 3:
      out[0] = s;
      out[1] = -1;
      out[2] = -t;
      break;
    case 4:
      out[0] = s;
      out[1] = -t;
      out[2] = 1;
      break;
    default:
      out[0] = -s;
      out[1] = -t;
      out[2] = -1;
  }
}

/**
 * Works in place: blocks go in row order, so a write never lands on a texel a later block reads
 * @param rgb - The face's RGB floats at its front, replaced there by the halved face
 * @param size - The face's width, a power of two above 1
 */
function halveFace(rgb: Float32Array, size: number): void {
  const half = size >> 1;
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const a = (y * 2 * size + x * 2) * 3;
      const b = a + size * 3;
      const o = (y * half + x) * 3;
      for (let c = 0; c < 3; c++) rgb[o + c] = 0.25 * (rgb[a + c] + rgb[a + 3 + c] + rgb[b + c] + rgb[b + 3 + c]);
    }
  }
}

function packRg11b10(rgb: Float32Array, texels: number): Uint32Array {
  const out = new Uint32Array(texels);
  for (let i = 0; i < texels; i++) {
    out[i] =
      (toUfloat(rgb[i * 3], 6) | (toUfloat(rgb[i * 3 + 1], 6) << 11) | (toUfloat(rgb[i * 3 + 2], 5) << 22)) >>> 0;
  }
  return out;
}

/**
 * `rg11b10ufloat` holds light above 1 in half the memory of `rgba16float`, and filters with no
 * extension. Each mip averages the one above, for the prefilter in `generateIblSpecialCubemap.ts`
 * @internal
 */
export function equirectToCube(image: RadianceImage, faceSize: number, label: string): CubeTexture {
  const { width, height, data } = image;
  const dir = new Float64Array(3);
  const rgb = new Float32Array(faceSize * faceSize * 3);
  const sources: CompressedSource[] = [];

  for (let face = 0; face < 6; face++) {
    for (let y = 0; y < faceSize; y++) {
      const t = ((y + 0.5) / faceSize) * 2 - 1;
      for (let x = 0; x < faceSize; x++) {
        const s = ((x + 0.5) / faceSize) * 2 - 1;
        faceDirection(face, s, t, dir);
        const length = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
        const u = (Math.atan2(dir[2], dir[0]) / (2 * Math.PI) + 0.5) * width - 0.5;
        const v = (0.5 - Math.asin(dir[1] / length) / Math.PI) * height - 0.5;

        const x0 = Math.floor(u);
        const y0 = Math.max(0, Math.floor(v));
        const fx = u - x0;
        const fy = Math.min(1, Math.max(0, v - y0));
        const left = ((x0 % width) + width) % width;
        const right = (left + 1) % width;
        const top = Math.min(y0, height - 1) * width;
        const bottom = Math.min(y0 + 1, height - 1) * width;

        const o = (y * faceSize + x) * 3;
        for (let c = 0; c < 3; c++) {
          const upper = data[(top + left) * 3 + c] * (1 - fx) + data[(top + right) * 3 + c] * fx;
          const lower = data[(bottom + left) * 3 + c] * (1 - fx) + data[(bottom + right) * 3 + c] * fx;
          rgb[o + c] = upper * (1 - fy) + lower * fy;
        }
      }
    }

    const levels: Uint32Array[] = [packRg11b10(rgb, faceSize * faceSize)];
    for (let size = faceSize; size > 1; size >>= 1) {
      halveFace(rgb, size);
      levels.push(packRg11b10(rgb, (size >> 1) ** 2));
    }
    sources.push(
      new CompressedSource({ resource: levels, format: 'rg11b10ufloat', width: faceSize, height: faceSize, label }),
    );
  }

  const [right, left, top, bottom, front, back] = sources;

  return CubeTexture.from({
    faces: { right, left, top, bottom, front, back },
    label,
    mipLevelCount: right.mipLevelCount,
  });
}
