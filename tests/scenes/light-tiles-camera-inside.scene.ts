import type { TestScene } from '@test-utils';

import { lightTilesScene } from './helpers/lightTilesScene';

/** The camera stands inside one light's range, which has no bounded image and must reach every tile. */
export const scene: TestScene = lightTilesScene({ cameraInside: true });
