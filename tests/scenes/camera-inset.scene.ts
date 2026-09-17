import type { TestScene } from '@test-utils';

import { cameraInsetScene } from './helpers/cameraInsetScene';

/** Picture-in-picture straight to the screen — the camera's frame is already in target space. */
export const scene: TestScene = cameraInsetScene();
