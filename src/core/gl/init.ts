import { extensions } from 'pixi.js';

import { RetireSystem } from '../RetireSystem';
import { LightingSystemGl } from './LightingSystemGl';
import { MaterialSystemGl } from './shader/MaterialSystemGl';
import { View3DPipeGl } from './View3DPipeGl';

extensions.add(LightingSystemGl, MaterialSystemGl, RetireSystem, View3DPipeGl);

export * from './index';
