import type { TestScene } from '@test-utils';

import { lightTilesScene } from './helpers/lightTilesScene';

export const scene: TestScene = lightTilesScene({ offset: true, composite: true, inset: true });
