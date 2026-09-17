// The CDN entry. A bundle exports its whole surface, so re-exporting `core/gl/**` and
// `core/gpu/**` here would pull both backends into the entry chunk and defeat the lazy
// loading `init.ts` sets up. `core/index.bundle` is the core barrel without them.
//
// `extras` is not re-exported here either. It ships as its own CDN file,
// `pixi-3d-extras.mjs`, built from `extras/index.ts` and importing the engine from this
// entry's output, so a page pays for it only by importing it.
export * from './animation';
export * from './assets';
export * from './core/index.bundle';
export * from './events';
export * from './geometry';
export * from './materials';
export * from './math';
export * from './post-processing';
export * from './scene';
export * from './utils';

import './init';
