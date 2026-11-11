import type { TestScene } from '@test-utils';

import { cullFrustumBatchedScene } from './helpers/cullFrustumBatchedScene';

export const scene: TestScene = cullFrustumBatchedScene('cpu');
