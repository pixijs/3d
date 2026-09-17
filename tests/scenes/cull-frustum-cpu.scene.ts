import type { TestScene } from '@test-utils';

import { cullFrustumScene } from './helpers/cullFrustumScene';

/** CPU cull against a detached frustum — must match the gpu variant (same survivors). */
export const scene: TestScene = cullFrustumScene('cpu');
