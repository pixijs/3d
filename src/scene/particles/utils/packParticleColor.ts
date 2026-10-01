import { srgbToLinear } from '../../../materials/BaseMaterial3D';

/**
 * Display-space sRGB byte to linear byte, precomputed once
 *
 * Particle colours are authored in display space like every other
 * `ColorSource` in the engine, but they are packed per particle per frame, and a
 * table lookup keeps that off the `Math.pow` path. The 8-bit round-trip is
 * exact for 8-bit inputs, which is all the `unorm8x4` vertex attribute can
 * hold anyway.
 */
const SRGB_TO_LINEAR_BYTE = /* @__PURE__ */ (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = Math.round(srgbToLinear(i / 255) * 255);
  return table;
})();

/**
 * Packs a display-space `0xRRGGBB` tint plus opacity into the `unorm8x4`
 * attribute the particle shader reads
 *
 * Linear RGB lands in bytes 0–2, alpha in byte 3. Byte 0 is the low byte of the
 * word, because every platform WebGL and WebGPU run on stores vertex data
 * little-endian. Alpha stays linear (it is coverage, not light), matching the
 * rest of the engine's premultiply-at-output convention.
 * @param color - Display-space `0xRRGGBB` tint
 * @param alpha - Opacity in `[0, 1]`
 * @returns The packed word `ParticleContainer3D.writePacked` takes
 * @category scene
 * @advanced
 */
export function packParticleColor(color: number, alpha: number): number {
  const r = SRGB_TO_LINEAR_BYTE[(color >> 16) & 0xff];
  const g = SRGB_TO_LINEAR_BYTE[(color >> 8) & 0xff];
  const b = SRGB_TO_LINEAR_BYTE[color & 0xff];
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 255 : (alpha * 255 + 0.5) | 0;

  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}
