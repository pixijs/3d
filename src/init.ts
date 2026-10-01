import { extensions, ExtensionType } from 'pixi.js';

import './assets/init';
import './events/init';
import { addUniformParsers } from './utils/addUniformParsers';

/**
 * One renderer loader per backend
 *
 * Each backend's systems and pipes live in their own chunk. The renderer awaits the matching
 * loader in `init()`, so a page downloads only the backend it picked. A renderer initialised with
 * `skipExtensionImports: true` skips loaders, so the page imports `@pixi/3d/webgl` or
 * `@pixi/3d/webgpu` itself.
 */
const backendLoaders = [
  { extension: { type: ExtensionType.WebGLLoader, name: 'pixi3d' }, load: () => import('./core/gl/init') },
  { extension: { type: ExtensionType.WebGPULoader, name: 'pixi3d' }, load: () => import('./core/gpu/init') },
];

addUniformParsers();
extensions.add(...backendLoaders);
