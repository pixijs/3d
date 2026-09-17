import type { TestScene } from '@test-utils';

import { shadowCullScene } from './helpers/shadowCullScene';

/**
 * Shadow-caster culling with `cull: 'cpu'` — the JS producer on both backends
 * (WebGPU runs it instead of the compute pass; WebGL in the batcher's replay).
 * Shares {@link shadowCullScene} with the `'gpu'` variant, so the references must
 * match — the producer-parity guard.
 */
export const scene: TestScene = shadowCullScene('cpu');
