import type { TestScene } from '@test-utils';

import { shadowCullScene } from './helpers/shadowCullScene';

/**
 * Shadow-caster culling with `cull: 'gpu'` — WebGPU compacts survivors in a
 * compute pass; WebGL degrades to the CPU producer in the batcher's replay. See
 * {@link shadowCullScene} for the parity/no-false-positive rationale.
 */
export const scene: TestScene = shadowCullScene('gpu');
