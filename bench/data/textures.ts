/**
 * The textured field scenes' maps (`textures`, `geometries`): a base-colour map and a matching normal map per
 * material, generated from a seed rather than loaded.
 *
 * Both maps are opaque, so premultiplying them changes nothing and both backends sample the same texels however
 * their uploads treat alpha.
 */

import type { PixelTexture } from './cloud.ts';
import { rng } from './rng.ts';

/** Edge of both maps, in texels. */
export const MAP_SIZE = 256;

export interface MapPair {
  /** sRGB colour: tiled blocks of one hue, with per-texel grain. */
  albedo: PixelTexture;
  /** Tangent-space normals of the same blocks' bevels, so the two maps agree. */
  normal: PixelTexture;
}

/** An sRGB colour from hue, saturation and value, in 0..255 and not yet rounded. */
function hsvToSrgb(hue: number, saturation: number, value: number): [number, number, number] {
  const channel = (n: number): number => {
    const k = (n + hue * 6) % 6;
    return (value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [channel(5), channel(3), channel(1)];
}

/** The map pair for `seed`, written through a clamped array, which rounds as a canvas's pixels do. */
export function proceduralMaps(seed: number, size = MAP_SIZE): MapPair {
  const random = rng(7000 + seed);
  const hue = random.next();
  const blocks = 4 + random.int(5);
  const cell = size / blocks;
  const height = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = y * size + x;
      const fx = (x % cell) / cell;
      const fy = (y % cell) / cell;
      const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
      height[at] = Math.min(edge * 6, 1) * 0.8 + random.next() * 0.2;
      const bx = Math.floor(x / cell);
      const by = Math.floor(y / cell);
      const light = 0.55 + 0.35 * (((bx * 7 + by * 13) % 5) / 4) - 0.1 * random.next();
      const [r, g, b] = hsvToSrgb((hue + ((bx + by) % 2) * 0.03) % 1, 0.6, light);
      albedo[at * 4] = r;
      albedo[at * 4 + 1] = g;
      albedo[at * 4 + 2] = b;
      albedo[at * 4 + 3] = 255;
    }
  }
  const normal = new Uint8ClampedArray(size * size * 4);
  const heightAt = (x: number, y: number): number => height[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      const nx = (heightAt(x - 1, y) - heightAt(x + 1, y)) * 2;
      const ny = (heightAt(x, y - 1) - heightAt(x, y + 1)) * 2;
      const length = Math.hypot(nx, ny, 1);
      normal[at] = ((nx / length) * 0.5 + 0.5) * 255;
      normal[at + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      normal[at + 2] = ((1 / length) * 0.5 + 0.5) * 255;
      normal[at + 3] = 255;
    }
  }
  const texture = (pixels: Uint8ClampedArray): PixelTexture => ({
    width: size,
    height: size,
    pixels: new Uint8Array(pixels.buffer),
  });
  return { albedo: texture(albedo), normal: texture(normal) };
}
