import type { TestScene } from '@test-utils';

import { cullFrustumBatchedScene } from './helpers/cullFrustumBatchedScene';

/** GPU cull of a BatchedMesh3D (user batch) against a detached frustum — must match the cpu variant. */
export const scene: TestScene = cullFrustumBatchedScene('gpu');
