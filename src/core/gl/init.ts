import { extensions } from 'pixi.js';

import { LightingSystemGl } from './LightingSystemGl';
import { MaterialSystemGl } from './shader/MaterialSystemGl';
import { View3DPipeGl } from './View3DPipeGl';

extensions.add(LightingSystemGl, MaterialSystemGl, View3DPipeGl);
