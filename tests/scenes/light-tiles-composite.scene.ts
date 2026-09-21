import type { TestScene } from '@test-utils';

import { lightTilesScene } from './helpers/lightTilesScene';

/** Through an offscreen scene transient: the viewport starts at the texture's origin while the view sits elsewhere on screen. */
export const scene: TestScene = lightTilesScene({ offset: true, composite: true });
