import type { TestScene } from '@test-utils';

import { visibilityScene } from './helpers/visibilityScene';

/** No frustum producer — hide lands via the dirty-gated visibility-only walk. */
export const scene: TestScene = visibilityScene({ cull: 'off' });
