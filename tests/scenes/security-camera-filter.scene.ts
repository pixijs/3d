import type { TestScene } from '@test-utils';

import { securityCameraScene } from './helpers/securityCameraScene';

/**
 * The same feed with the view inside a pixi filter, so the outer target is non-root. The view
 * camera's winding parity flips with it and the feed's — which writes a texture either way —
 * does not.
 */
export const scene: TestScene = securityCameraScene({ filter: true });
