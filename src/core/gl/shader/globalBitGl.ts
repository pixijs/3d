import { BindGroup, Texture } from 'pixi.js';
import type { UniformData, WebGLRenderer } from 'pixi.js';

import type { View3D } from '../../../scene/View3D';
import { View3DGlobalData } from '../../../scene/View3DGlobalData';
import { createGlobalUniformGroup } from '../../GlobalUniformGroup';
import { MAX_LIGHTS } from '../../lightLimits';
import { MAX_SHADOW_SLOTS } from '../../render-passes/shadow/shadowPassUtils';
import { LightStructGl, ShadowDataStructGl } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';
import { CUBETEXTURE_EMPTY, DEPTH_EMPTY, UINT_EMPTY } from '../../textures/DefaultTextures';

/**
 * Uniforms keep the order `createGlobalUniformGroup` builds them in, the order pixi lays the buffer out in. Each
 * texture needs an entry in `getGlobalGlData`'s bind group, or WebGL draws without it rather than throwing.
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
      uFogColor: 'vec3<f32>',
      uDisplayExposure: 'f32',
      uFogParams: 'vec3<f32>',
      uExposure: 'f32',
      uHemisphereSky: 'vec3<f32>',
      uHemisphereGround: 'vec3<f32>',
      uHemisphereUp: 'vec3<f32>',
      uEnvironmentMaxMipLevel: 'f32',
      uLightData: `array<vec4<f32>, ${MAX_LIGHTS * 4}>`,
      uShadowData: `array<vec4<f32>, ${MAX_SHADOW_SLOTS * 6}>`,

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

/** `uEnvironmentMaxMipLevel` stands in for WGSL's `textureNumLevels`, which GLSL ES 3.00 lacks */
function createUniformsGl() {
  return {
    uEnvironmentMaxMipLevel: { value: 0, type: 'f32' },
  } satisfies Record<string, UniformData>;
}

type UniformsGl = ReturnType<typeof createUniformsGl>;

/**
 * This renderer's `View3DGlobalData` on the view: made on first use, destroyed by pixi when the view unloads. Each
 * placeholder is the texture kind its sampler reads, so a slot nothing has bound yet still samples.
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
    const group = new BindGroup({
      global: globalUniformGroupGl,
      uEnvironmentTexture: CUBETEXTURE_EMPTY.source,
      uBrdfLutTexture: Texture.EMPTY.source,
      uMaterialStorage: UINT_EMPTY.source,
      uShadowMap: DEPTH_EMPTY.source,
      uBonePitTexture: Texture.EMPTY.source,
      uOpaqueDepthTexture: Texture.EMPTY.source,
      uOpaqueColorTexture: Texture.EMPTY.source,
      uMorphTexture: Texture.EMPTY.source,
      uGeometryTexture: UINT_EMPTY.source,
      uMeshStoreTexture: UINT_EMPTY.source,
      uRenderInstanceTexture: UINT_EMPTY.source,
      batchTransform: renderer.material3d.batcher.batchTransform,
      uInstanceStoreTexture: UINT_EMPTY.source,
    });

    data = new View3DGlobalData(globalUniformGroupGl, group, {
      opaqueColor: { group, slot: 'uOpaqueColorTexture' },
      opaqueDepth: { group, slot: 'uOpaqueDepthTexture' },
      shadowMap: { group, slot: 'uShadowMap' },
    });
    view3d._gpuData[renderer.uid] = data;
  }
  return data;
}
