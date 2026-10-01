import type { ShadowFilter } from '../../render-passes/shadow/shadowPassUtils';

/**
 * One PCF tap's offset in texels; the shader multiplies it by `1 / mapSize`
 * @internal
 */
export type ShadowTap = readonly [number, number];

/**
 * One tap at the centre, for `'hard'`
 *
 * The shadow map's comparison sampler filters linearly, so even one fetch compares a 2×2 block: the
 * cheapest clean edge.
 */
const CENTER: readonly ShadowTap[] = [[0, 0]];

/**
 * A 2×2 grid at ±1 texel, for `'pcf'`, the default
 *
 * Four filtered fetches cover a 4×4 block of texels. At this spacing their 2×2 footprints sit side
 * by side rather than overlap, which widens the penumbra.
 */
const GRID_2X2: readonly ShadowTap[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * A 3×3 grid at two-texel spacing, for `'pcf-high'`
 *
 * Nine filtered fetches cover a 6×6 block for a wide, soft penumbra. The two-texel spacing keeps
 * each tap's footprint off its neighbours'.
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
 * The PCF tap offsets for each `shadowFilter`, in texels
 *
 * `createShadowBitGpu` and `createShadowBitGl` both build their sampling from it, so a filter looks
 * the same on both backends.
 * @internal
 */
export const SHADOW_TAPS: Record<ShadowFilter, readonly ShadowTap[]> = {
  hard: CENTER,
  pcf: GRID_2X2,
  'pcf-high': GRID_3X3,
};
