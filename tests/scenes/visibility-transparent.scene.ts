import type { TestScene } from '@test-utils';

import { visibilityScene } from './helpers/visibilityScene';

export const scene: TestScene = visibilityScene({ cull: 'gpu', alphaMode: 'blend' });
