import type { TestScene } from '@test-utils';

import { cullFrustumScene } from './helpers/cullFrustumScene';

/** GPU-compute cull against a detached frustum — only the central cubes survive. */
export const scene: TestScene = cullFrustumScene('gpu');
