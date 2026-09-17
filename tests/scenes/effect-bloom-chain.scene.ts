import type { TestScene } from '@test-utils';

import { TintEffect } from '~/extras/post-processing/effects/TintEffect';

import { bloomScene } from './helpers/bloomScene';

/**
 * Bloom mid-chain: `[bloom, tint]`. The pyramid's combine writes the ping-pong transient rather
 * than presenting, and the tint reads that and presents, so the glow is tinted along with the
 * frame. Same picture as `effect-bloom` under a warm tint, so the two baselines differ only by
 * the multiply.
 */
export const scene: TestScene = bloomScene([new TintEffect({ tint: 0xffcc99 })]);
