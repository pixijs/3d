import type { TestScene } from '@test-utils';

import { securityCameraScene } from './helpers/securityCameraScene';

/** A pass drawing into its own render texture, shown on a TV in the same scene. */
export const scene: TestScene = securityCameraScene();
