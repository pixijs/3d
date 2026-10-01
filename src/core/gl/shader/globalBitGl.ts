import { BindGroup, Texture } from 'pixi.js';
import type { UniformData, WebGLRenderer } from 'pixi.js';

import { Matrix4 } from '../../../math/matrix/Matrix4';
import { MAX_LIGHTS } from '../../../scene/View3D';
import type { View3D } from '../../../scene/View3D';
import { View3DGlobalData } from '../../../scene/View3DGlobalData';
import { createGlobalUniformGroup } from '../../GlobalUniformGroup';
import { MAX_SHADOW_SLOTS } from '../../render-passes/shadow/shadowPassUtils';
import { LightStructGl, ShadowDataStructGl } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';
import { CUBETEXTURE_EMPTY, DEPTH_EMPTY, UINT_EMPTY } from '../../textures/DefaultTextures';

/**
 * WebGL-specific ShaderBit that defines the global uniform struct and bindings for the 3D scene
 *
 * Light and shadow data sit in flat uniform arrays, `uLightData` and `uShadowData`, with the same
 * layout and the same view-owned arrays behind them as on WebGPU; `LightDataList` and
 * `ShadowDataList` own the layouts. The stores WebGPU binds as storage buffers are data textures
 * here: `uMaterialStorage`, and `uMorphTexture` and `uGeometryTexture`, which only the morph bits
 * read.
 *
 * - `uGlobalLightParams`: `xyz` is the summed ambient light. `LightingSystemGl` also writes the
 *   light count into `w` every frame, but no shader reads it: the light loop walks the light-tile
 *   masks instead.
 * - `uFogColor` is linear and premultiplied by `uExposure`. `uFogParams` is `(near, far, density)`:
 *   linear fog reads `x` and `y`, the exponential fogs read `z`.
 * - `uExposure` scales linear scene radiance before any tone mapping.
 * - The `uHemisphere*` uniforms hold the environment while it's a `Hemisphere`: sky and ground
 *   premultiplied by its intensity, up normalized. Under any other environment they keep stale
 *   values that no compiled shader reads.
 * - `uEnvironmentMaxMipLevel` is the highest mip index of the bound environment cube. WebGPU reads
 *   it with `textureNumLevels`, but GLSL ES 3.00 has no `textureQueryLevels`, so `View3DPipeGl`
 *   sets it when it binds the cube.
 *
 * The header names the `Light.type` codes `LightDataList` writes, so each shader declares them
 * once however many bits read them.
 *
 * The order of the texture bindings sets their slots in the bind group `getGlobalGlData` builds.
 * @internal
 */
export const globalBitGl: ShaderBit = {
  name: 'globalGl',
  structs: {
    Light: LightStructGl,
    ShadowData: ShadowDataStructGl,
  },
  bindings: {
    global: {
      uGlobalLightParams: 'vec4<f32>',
      uTime: 'f32',
      uBatchWorldMatrix: 'mat4x4<f32>',
      uFogColor: 'vec3<f32>',
      uFogParams: 'vec3<f32>',
      uExposure: 'f32',
      uHemisphereSky: 'vec3<f32>',
      uHemisphereGround: 'vec3<f32>',
      uHemisphereUp: 'vec3<f32>',
      uLightData: `array<vec4<f32>, ${MAX_LIGHTS * 4}>`,
      uShadowData: `array<vec4<f32>, ${MAX_SHADOW_SLOTS * 6}>`,

      uEnvironmentMaxMipLevel: 'f32',
      uEnvironmentTexture: 'texture_cube<f32>',
      uBrdfLutTexture: 'texture_2d<f32>',
      uMaterialStorage: 'texture_2d<u32>',
      uShadowMap: 'texture_depth_2d_array',
      uBonePitTexture: 'texture_2d<f32>',
      uOpaqueDepthTexture: 'texture_2d<f32>',
      uOpaqueColorTexture: 'texture_2d<f32>',
      uMorphTexture: 'texture_2d<f32>',
      uGeometryTexture: 'texture_2d<u32>',
    },
  },
  gl: {
    header: /*glsl*/ `
const float LIGHT_DIRECTIONAL = 0.0;
const float LIGHT_POINT = 1.0;
const float LIGHT_SPOT = 2.0;
`,
  },
};

/**
 * Builds the uniforms only the GLSL shaders declare, which the WebGL global group adds to the shared
 * set: the batch's world matrix and the environment cube's highest mip level
 * @returns A fresh set of uniform entries
 */
function createUniformsGl() {
  return {
    uBatchWorldMatrix: { value: new Matrix4(), type: 'mat4x4<f32>' },
    uEnvironmentMaxMipLevel: { value: 0, type: 'f32' },
  } satisfies Record<string, UniformData>;
}

/** The uniforms {@link createUniformsGl} builds */
type UniformsGl = ReturnType<typeof createUniformsGl>;

/**
 * This renderer's global data on the View3D, minted on first use
 *
 * Lives in the View's `_gpuData` slot for the renderer, which is also the View's payload in
 * pixi's renderer GC: pixi clears the slot when the View unloads or the renderer is destroyed,
 * and the next call mints a fresh one.
 *
 * `createGlobalUniformGroup` builds the uniform group, with the WebGL-only uniforms from
 * `createUniformsGl` added. The slot's type covers both backends, so the result is cast to the
 * WebGL shape: a WebGL renderer's slot only ever holds what this function mints.
 *
 * Bind group slots follow `generateGroupMap`: the uniform group at 0, then the texture bindings
 * of `globalBitGl` and `instanceFetchBitGl` in declaration order.
 *
 * - `View3DPipeGl.execute` binds 2 `uBrdfLutTexture` when the view has an environment,
 *   1 `uEnvironmentTexture` when that environment is a cube map, and 3 `uMaterialStorage`,
 *   5 `uBonePitTexture`, 8 `uMorphTexture` and 9 `uGeometryTexture` every frame.
 * - `View3DPipeGl.globalSlots` names 4 `uShadowMap`, 6 `uOpaqueDepthTexture` and
 *   7 `uOpaqueColorTexture` for the passes that fill them.
 * - `renderForwardBatchesGl` binds 10 `uMeshStoreTexture` and 11 `uRenderInstanceTexture` per batch.
 *
 * Each placeholder is the kind of texture its sampler reads, so a slot nothing has bound yet is
 * still valid to sample. The shadow map's is the comparison-mode placeholder, which the shadow pass
 * swaps for its live map when it renders and restores when it releases the map.
 * @param view3d - The View3D instance to get or create the global WebGL data for.
 * @param renderer - The renderer whose slot on the View is read.
 * @returns The renderer's global data on the View.
 * @internal
 */
export function getGlobalGlData(view3d: View3D, renderer: WebGLRenderer): View3DGlobalData<UniformsGl> {
  let data = view3d._gpuData[renderer.uid] as View3DGlobalData<UniformsGl> | undefined;
  if (!data) {
    const globalUniformGroupGl = createGlobalUniformGroup(
      view3d._lightDataList.data,
      view3d._shadowDataList.data,
      createUniformsGl(),
    );

    const globalBindGroupGl = new BindGroup({
      0: globalUniformGroupGl,
      1: CUBETEXTURE_EMPTY.source,
      2: Texture.EMPTY.source,
      3: UINT_EMPTY.source,
      4: DEPTH_EMPTY.source,
      5: Texture.EMPTY.source,
      6: Texture.EMPTY.source,
      7: Texture.EMPTY.source,
      8: Texture.EMPTY.source,
      9: UINT_EMPTY.source,
      10: UINT_EMPTY.source,
      11: UINT_EMPTY.source,
    });

    data = new View3DGlobalData(globalUniformGroupGl, globalBindGroupGl);
    view3d._gpuData[renderer.uid] = data;
  }
  return data;
}
