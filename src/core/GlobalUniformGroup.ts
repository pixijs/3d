import { UniformGroup } from 'pixi.js';
import type { UniformData } from 'pixi.js';

import { MAX_LIGHTS } from '../scene/View3D';
import { MAX_SHADOW_SLOTS } from './render-passes/shadow/shadowPassUtils';

/**
 * Builds the uniform group every 3D shader reads as `global`, its keys in the order `globalBitGpu` and
 * `globalBitGl` declare them, since pixi lays the buffer out in key order. It's static, so packed lights and
 * shadows upload only when each pipe's `_updateGlobalUniforms` calls `update()`, every frame.
 * @param lightData - `LightDataList.data`, held as `uLightData`, so packing a light writes the uniform.
 * @param shadowData - `ShadowDataList.data`, held as `uShadowData`.
 * @param extra - A backend's own uniforms, laid out before the light data.
 * @internal
 */
export function createGlobalUniformGroup<TExtra extends Record<string, UniformData> = Record<never, UniformData>>(
  lightData: Float32Array,
  shadowData: Float32Array,
  extra?: TExtra,
) {
  return new UniformGroup(
    {
      uGlobalLightParams: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
      uTime: { value: 0, type: 'f32' },
      uFogColor: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uDisplayExposure: { value: 1, type: 'f32' },
      uFogParams: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uExposure: { value: 1, type: 'f32' },
      uHemisphereSky: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uHemisphereGround: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uHemisphereUp: { value: new Float32Array([0, 1, 0]), type: 'vec3<f32>' },
      ...(extra as TExtra),
      uLightData: { value: lightData, type: 'vec4<f32>', size: MAX_LIGHTS * 4 },
      uShadowData: { value: shadowData, type: 'vec4<f32>', size: MAX_SHADOW_SLOTS * 6 },
    },
    { isStatic: true, ubo: true },
  );
}

/** @internal */
export type GlobalUniformGroup<TExtra extends Record<string, UniformData> = Record<never, UniformData>> = ReturnType<
  typeof createGlobalUniformGroup<TExtra>
>;
