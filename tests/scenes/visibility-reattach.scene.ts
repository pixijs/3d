import type { TestScene } from '@test-utils';

import { visibilityScene } from './helpers/visibilityScene';

/** Hidden cubes removed and re-added while hidden — the returning members must re-mint their rows. */
export const scene: TestScene = visibilityScene({ cull: 'cpu', reattachHidden: true });
