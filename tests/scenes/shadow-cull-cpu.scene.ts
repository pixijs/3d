import type { TestScene } from '@test-utils';

import { shadowCullScene } from './helpers/shadowCullScene';

export const scene: TestScene = shadowCullScene('cpu');
