import type { TestScene } from '@test-utils';

import { TintEffect } from '~/extras/post-processing/effects/TintEffect';

import { bloomScene } from './helpers/bloomScene';

export const scene: TestScene = bloomScene([new TintEffect({ tint: 0xffcc99 })]);
