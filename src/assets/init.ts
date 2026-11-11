import { extensions } from 'pixi.js';

import { loadCubemap } from './loaders/cubemap/loadCubemap';
import { loadGlb } from './loaders/gltf/loadGlb';
import { loadGltf } from './loaders/gltf/loadGltf';
import { loadHdr } from './loaders/hdr/loadHdr';

extensions.add(loadGltf, loadGlb, loadCubemap, loadHdr);
