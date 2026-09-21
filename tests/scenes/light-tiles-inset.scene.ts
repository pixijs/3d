import type { TestScene } from '@test-utils';

import { lightTilesScene } from './helpers/lightTilesScene';

/** A second, orthographic camera draws the wall into a corner of the view: its own mask, its own viewport. */
export const scene: TestScene = lightTilesScene({ inset: true });
