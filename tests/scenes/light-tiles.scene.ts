import type { TestScene } from '@test-utils';

import { lightTilesScene } from './helpers/lightTilesScene';

/** Full screen, straight to the target: lights on every screen edge and corner, one crossing the camera plane, one behind it. */
export const scene: TestScene = lightTilesScene();
