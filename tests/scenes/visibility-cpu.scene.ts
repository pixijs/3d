import type { TestScene } from '@test-utils';

import { visibilityScene } from './helpers/visibilityScene';

/** CPU cull producer honouring the visibility lane — parity with the GPU variant. */
export const scene: TestScene = visibilityScene({ cull: 'cpu' });
