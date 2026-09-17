import type { TestScene } from '@test-utils';

import { cameraInsetScene } from './helpers/cameraInsetScene';

/**
 * The same inset through an offscreen scene transient, with the view off the screen origin —
 * the executor has to shift the camera's frame into the transient's own space.
 */
export const scene: TestScene = cameraInsetScene({ composite: true });
