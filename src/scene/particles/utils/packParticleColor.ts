/**
 * Packs a tint and opacity into the 32-bit word {@link ParticleContainer3D.writePacked} takes
 *
 * Red lands in the low byte and alpha in the high byte, as {@link ParticleContainerViews.u32} holds
 * the colour.
 * @param color - `0xRRGGBB` tint, in display (sRGB) space
 * @param alpha - Opacity, 0 to 1
 * @returns The packed word
 * @category scene
 * @advanced
 */
export function packParticleColor(color: number, alpha: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const a = alpha <= 0 ? 0 : alpha >= 1 ? 255 : (alpha * 255 + 0.5) | 0;

  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}
