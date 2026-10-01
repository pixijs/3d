import { extensions } from 'pixi.js';

import { loadCubemap } from './loaders/cubemap/loadCubemap';
import { loadGlb } from './loaders/gltf/loadGlb';
import { loadGltf } from './loaders/gltf/loadGltf';

extensions.add(loadGltf, loadGlb, loadCubemap);
