import { extensions, ExtensionType } from 'pixi.js';

import './assets/init';
import './events/init';
import { addUniformParsers } from './utils/addUniformParsers';

/** Loaded lazily, so a page downloads only the backend its renderer picks */
const backendLoaders = [
  { extension: { type: ExtensionType.WebGLLoader, name: 'pixijs-3d' }, load: () => import('./core/gl/init') },
  { extension: { type: ExtensionType.WebGPULoader, name: 'pixijs-3d' }, load: () => import('./core/gpu/init') },
];

addUniformParsers();
extensions.add(...backendLoaders);
