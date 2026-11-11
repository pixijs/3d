import { extensions } from 'pixi.js';

import { ComputeSystemGpu } from './ComputeSystemGpu';
import { LightingSystemGpu } from './LightingSystemGpu';
import { MipChainSystemGpu } from './MipChainSystemGpu';
import { MaterialSystemGpu } from './shader/MaterialSystemGpu';
import { View3DPipeGpu } from './View3DPipeGpu';

extensions.add(ComputeSystemGpu, LightingSystemGpu, MipChainSystemGpu, MaterialSystemGpu, View3DPipeGpu);

export * from './index';
