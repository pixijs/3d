import type { ShadowFilter } from '../../render-passes/shadow/shadowPassUtils';

/**
 * A PCF tap offset in texel units — multiplied by `1 / mapSize` in the shader
 * @internal
 */
export type ShadowTap = readonly [number, number];

/**
 * Single centre tap: `'hard'`
 *
 * One fetch — but the shadow map's comparison sampler is linear, so even this
 * is a hardware 2×2 PCF: the cheapest clean edge.
 */
const CENTER: readonly ShadowTap[] = [[0, 0]];

/**
 * 2×2 grid at one-texel spacing: `'pcf'` (default)
 *
 * Four linear-PCF fetches ≈ a 16-sample kernel. Spaced a full texel apart (not
 * sub-texel) so the hardware 2×2 footprints tile into a wider penumbra instead
 * of overlapping.
 */
const GRID_2X2: readonly ShadowTap[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * 3×3 grid at two-texel spacing: `'pcf-high'`
 *
 * Nine linear-PCF fetches for a wide, soft penumbra; two-texel spacing broadens
 * the kernel rather than re-sampling the same texels each tap covers.
 */
const GRID_3X3: readonly ShadowTap[] = [
  [-2, -2],
  [0, -2],
  [2, -2],
  [-2, 0],
  [0, 0],
  [2, 0],
  [-2, 2],
  [0, 2],
  [2, 2],
];

/**
 * Per-tier PCF tap offsets in texel units — the single source of truth for
 * shadow kernels
 *
 * Identical across WebGL and WebGPU so a given `shadowFilter` renders the same
 * on both backends. Each tap is a hardware 2×2 bilinear PCF fetch (the shadow
 * sampler is a linear comparison sampler), so offsets are spaced a texel or
 * more apart to widen the kernel. Consumed by the per-backend bit factories
 * (`createShadowBitGpu`/`createShadowBitGl`), which wrap these offsets in each
 * backend's own sampling intrinsic.
 * @internal
 */
export const SHADOW_TAPS: Record<ShadowFilter, readonly ShadowTap[]> = {
  hard: CENTER,
  pcf: GRID_2X2,
  'pcf-high': GRID_3X3,
};
