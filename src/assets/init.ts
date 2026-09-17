import { extensions } from 'pixi.js';

import { loadCubemap } from './loaders/cubemap/loadCubemap';
import { loadGlb } from './loaders/gltf/loadGlb';
import { loadGltf } from './loaders/gltf/loadGltf';

// Registers the 3D asset parsers with pixi's `Assets`; the root entry imports this for its side effect.
extensions.add(loadGltf, loadGlb, loadCubemap);
