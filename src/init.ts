import { extensions, ExtensionType } from 'pixi.js';

import './assets/init';
import './events/init';
import { addUniformParsers } from './utils/addUniformParsers';

// Everything the root entries register on import. `index.ts` (npm) and `index.bundle.ts`
// (CDN) both import this file, so the two can't drift apart.
addUniformParsers();

// Each backend's systems and pipes live in their own chunk. The renderer awaits the
// matching loader during `init()`, so a page only downloads the backend it picked.
extensions.add(
  { extension: { type: ExtensionType.WebGLLoader, name: 'pixi3d' }, load: () => import('./core/gl/init') },
  { extension: { type: ExtensionType.WebGPULoader, name: 'pixi3d' }, load: () => import('./core/gpu/init') },
);
