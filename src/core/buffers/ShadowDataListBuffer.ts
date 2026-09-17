import { MAX_CASCADES } from '../render-passes/shadow/csmUtils';
import { MAX_SHADOW_LIGHTS, writeCascadeSlot } from '../render-passes/shadow/shadowPassUtils';
import { DataListBuffer } from './DataListBuffer';

/**
 * GPU storage buffer for shadow data
 *
 * Sequential list built each frame. Each entry corresponds to one shadow-casting
 * light or one cascade of a CSM light. Lights store the base index into this
 * buffer in `light._shadowDataIndex`.
 *
 * Layout (stride = 24 floats) matches `ShadowData` struct in the shader:
 * - [0..15]  lightSpaceMatrix (mat4x4)
 * - [16]     bias
 * - [17]     normalBias
 * - [18]     map size
 * - [19]     cascadeCount (0 = standard shadow, 2-4 = CSM)
 * - [20..23] cascadeSplits (vec4 — view-space split depths, only on first cascade entry)
 * @internal
 */
export class ShadowDataListBuffer extends DataListBuffer {
  constructor() {
    super({
      stride: 24,
      initialSize: MAX_SHADOW_LIGHTS * MAX_CASCADES,
      copier: writeCascadeSlot,
      label: 'ShadowDataList',
    });
  }
}
