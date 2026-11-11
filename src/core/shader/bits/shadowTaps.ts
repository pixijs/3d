import type { ShadowFilter } from '../../render-passes/shadow/shadowPassUtils';

/** @internal */
export type ShadowTap = readonly [number, number];

const CENTER: readonly ShadowTap[] = [[0, 0]];

const GRID_2X2: readonly ShadowTap[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

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
 * Offsets in texels, which the shadow bits scale by `1 / mapSize`
 * @internal
 */
export const SHADOW_TAPS: Record<ShadowFilter, readonly ShadowTap[]> = {
  hard: CENTER,
  pcf: GRID_2X2,
  'pcf-high': GRID_3X3,
};
