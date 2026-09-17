import type { TestScene } from '@test-utils';

import { visibilityScene } from './helpers/visibilityScene';

/** Alpha-blended grid — hide lands via the transparent pass's sort-time filter (never compacted). */
export const scene: TestScene = visibilityScene({ cull: 'gpu', alphaMode: 'blend' });
