import type { TestScene } from '@test-utils';

import { bloomScene } from './helpers/bloomScene';

/** Bloom as the lone presenter: its combine draws the View's target directly. */
export const scene: TestScene = bloomScene();
