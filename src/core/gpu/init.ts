import { extensions } from 'pixi.js';

import { ComputeSystemGpu } from './ComputeSystemGpu';
import { LightingSystemGpu } from './LightingSystemGpu';
import { MipChainSystemGpu } from './MipChainSystemGpu';
import { MaterialSystemGpu } from './shader/MaterialSystemGpu';
import { View3DPipeGpu } from './View3DPipeGpu';

// The WebGPU backend entry (`@pixi/3d/webgpu`). The root entry lazy-loads it through
// a renderer loader extension; importing it directly bundles the backend statically.
extensions.add(ComputeSystemGpu, LightingSystemGpu, MipChainSystemGpu, MaterialSystemGpu, View3DPipeGpu);
