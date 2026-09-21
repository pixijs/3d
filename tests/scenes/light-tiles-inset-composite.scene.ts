import type { TestScene } from '@test-utils';

import { lightTilesScene } from './helpers/lightTilesScene';

/** An inset camera while the scene draws through an offscreen transient: the inset's viewport is a corner of a rect that starts at the texture's origin, not at the view's place on screen. */
export const scene: TestScene = lightTilesScene({ offset: true, composite: true, inset: true });
