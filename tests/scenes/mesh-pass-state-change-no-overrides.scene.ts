import { solidMeshDescriptor } from '~/extras/post-processing/passes/solidMeshShader';

import { stateChangeScene } from './mesh-pass-state-change.scene';

export const scene = stateChangeScene({ ...solidMeshDescriptor(), overrides: undefined });
