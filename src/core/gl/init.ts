import { extensions } from 'pixi.js';

import { LightingSystemGl } from './LightingSystemGl';
import { MaterialSystemGl } from './shader/MaterialSystemGl';
import { View3DPipeGl } from './View3DPipeGl';

// The WebGL backend entry (`@pixi/3d/webgl`). The root entry lazy-loads it through
// a renderer loader extension; importing it directly bundles the backend statically.
extensions.add(LightingSystemGl, MaterialSystemGl, View3DPipeGl);
