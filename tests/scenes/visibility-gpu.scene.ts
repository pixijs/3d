import type { TestScene } from '@test-utils';

import { visibilityScene } from './helpers/visibilityScene';

/** GPU-compute cull honouring the visibility lane — hidden cubes drop, no rebundle. */
export const scene: TestScene = visibilityScene({ cull: 'gpu' });
