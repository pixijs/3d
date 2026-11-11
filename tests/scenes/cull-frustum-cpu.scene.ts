import type { TestScene } from '@test-utils';

import { cullFrustumScene } from './helpers/cullFrustumScene';

export const scene: TestScene = cullFrustumScene('cpu');
