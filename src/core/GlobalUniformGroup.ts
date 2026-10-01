import { UniformGroup } from 'pixi.js';
import type { UniformData } from 'pixi.js';

import { MAX_LIGHTS } from '../scene/View3D';
import { MAX_SHADOW_SLOTS } from './render-passes/shadow/shadowPassUtils';

/**
 * Builds the uniform group every 3D shader reads as `global`: light, shadow, fog, exposure,
 * hemisphere and time uniforms. The camera has its own group.
 *
 * The shader bits both backends share (lighting, fog, tone mapping, the hemisphere environment)
 * read this set by name, so both backends build their group here and pass their own uniforms as
 * `extra`. The group is static and outside a UBO; the systems that write it call `update()`.
 *
 * On WebGPU pixi lays the uniform buffer out in key order while the shader reads the struct in
 * declaration order, so the keys keep the order `globalBitGpu` declares its members in. WebGL sets
 * each uniform by name, so its `extra` can sit anywhere. `uFogColor` holds linear light already
 * premultiplied by exposure, so the fog bits mix in the space the lit colour is in.
 *
 * Takes the packed lists rather than the View, because `View3D`'s own type is built on the type
 * inferred here. `uLightData` and `uShadowData` are those arrays themselves, so packing a light or
 * a shadow slot writes the uniform.
 * @param lightData - The View's packed light list (`View3D._lightDataList.data`), used as `uLightData`
 * @param shadowData - The View's packed shadow list (`View3D._shadowDataList.data`), used as `uShadowData`
 * @param extra - Uniforms one backend adds to the shared set; none on WebGPU
 * @returns A fresh global uniform group
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
      uFogParams: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uExposure: { value: 1, type: 'f32' },
      uHemisphereSky: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uHemisphereGround: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uHemisphereUp: { value: new Float32Array([0, 1, 0]), type: 'vec3<f32>' },
      ...(extra as TExtra),
      uLightData: { value: lightData, type: 'vec4<f32>', size: MAX_LIGHTS * 4 },
      uShadowData: { value: shadowData, type: 'vec4<f32>', size: MAX_SHADOW_SLOTS * 6 },
    },
    { isStatic: true, ubo: false },
  );
}

/**
 * The group {@link createGlobalUniformGroup} builds, with `uniforms` typed from the shared set and `TExtra`
 * @internal
 */
export type GlobalUniformGroup<TExtra extends Record<string, UniformData> = Record<never, UniformData>> = ReturnType<
  typeof createGlobalUniformGroup<TExtra>
>;
