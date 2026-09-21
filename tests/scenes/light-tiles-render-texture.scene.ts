import type { TestScene } from '@test-utils';

import { lightTilesScene } from './helpers/lightTilesScene';

/** A camera draws the wall from the side into a render texture: its own mask, in a target with no root flip. */
export const scene: TestScene = lightTilesScene({ renderTexture: true });
