import type { TestScene } from '@test-utils';

import { lightTilesScene } from './helpers/lightTilesScene';

/** The view sits off the screen origin at a non-square size, so the tile grid has to start at the viewport's corner, not the target's. */
export const scene: TestScene = lightTilesScene({ offset: true });
