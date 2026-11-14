import { BindGroup, Texture, TextureStyle } from 'pixi.js';
import type { WebGPURenderer } from 'pixi.js';

import type { View3D } from '../../../scene/View3D';
import { View3DGlobalData } from '../../../scene/View3DGlobalData';
import { EMPTY_BUFFER_RESOURCE } from '../../buffers/emptyBufferResource';
import { createGlobalUniformGroup } from '../../GlobalUniformGroup';
import { MAX_LIGHTS } from '../../lightLimits';
import { MAX_SHADOW_SLOTS } from '../../render-passes/shadow/shadowPassUtils';
import {
  RenderableStruct,
  RenderableInstanceStruct,
  BoneMatrixStruct,
  GeometryDataStruct,
  LightStructGpu,
} from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';
import { CUBETEXTURE_EMPTY, DEPTH_EMPTY, DEPTH_VIEW_PLACEHOLDER, UINT_EMPTY } from '../../textures/DefaultTextures';

/**
 * Uniform members keep `createGlobalUniformGroup`'s key order, and every binding needs a resource of
 * its name in `getGlobalGpuData`; storage buffers stay `'vertex'` to fit WebGPU's default of 8 per stage
 * @internal
 */
export const globalBitGpu: ShaderBit = {
  name: 'global',
  structs: {
    Renderable: RenderableStruct,
    RenderableInstance: RenderableInstanceStruct,
    BoneMatrix: BoneMatrixStruct,
    GeometryData: GeometryDataStruct,
    Light: LightStructGpu,
  },
  bindings: {
    global: {
      /** Ambient in `xyz`; `w` holds the light count, which no shader reads */
      uGlobalLightParams: 'vec4<f32>',
      uTime: 'f32',
      /** Premultiplied by `uExposure`, since the fog bits run after the template applies exposure */
      uFogColor: 'vec3<f32>',
      /** `uExposure` raised to `1 / 2.2`, for shaders that run in display space */
      uDisplayExposure: 'f32',
      /** `(near, far, density)` */
      uFogParams: 'vec3<f32>',
      uExposure: 'f32',
      /**
       * Sky colour; it and the next two members are written only under a `Hemisphere` environment, the
       * only one whose bits read them
       */
      uHemisphereSky: 'vec3<f32>',
      uHemisphereGround: 'vec3<f32>',
      uHemisphereUp: 'vec3<f32>',
      /** Four `vec4` per light, as `LightDataList` lays them out */
      uLightData: `array<vec4<f32>, ${MAX_LIGHTS * 4}>`,
      uShadowData: `array<vec4<f32>, ${MAX_SHADOW_SLOTS * 6}>`,
      uSampler: 'sampler',
      uEnvironmentTexture: 'texture_cube<f32>',
      uBrdfLutTexture: 'texture_2d<f32>',
      uBrdfLutSampler: 'sampler',
      uShadowMap: 'texture_depth_2d_array',
      uShadowSampler: 'sampler_comparison',
      uOpaqueDepthTexture: 'texture_depth_2d',
      uOpaqueColorTexture: 'texture_2d<f32>',
      /** `u32` texels, so `getMaterial` reads exact bits */
      uMaterialStorage: 'texture_2d<u32>',

      uRenderableStorage: { type: `storage<Renderable>`, visibility: 'vertex' },
      uRenderableInstanceStorage: { type: `storage<RenderableInstance>`, visibility: 'vertex' },
      uBonePitStorage: { type: `storage<BoneMatrix>`, visibility: 'vertex' },
      uMorphStorage: { type: `storage<f32>`, visibility: 'vertex' },
      uGeometryStorage: { type: `storage<GeometryData>`, visibility: 'vertex' },
    },
  },
  /** The `Light.kind` values, as `LightDataList` writes them */
  gpu: {
    header: /*wgsl*/ `
const LIGHT_DIRECTIONAL: f32 = 0.0;
const LIGHT_POINT: f32 = 1.0;
const LIGHT_SPOT: f32 = 2.0;
`,
  },
};

/**
 * This renderer's global data on the View3D, made on first use
 *
 * Lives at `view._gpuData[renderer.uid]`. Pixi destroys it and clears the slot when the view
 * unloads or the renderer is destroyed, and the next call makes a new one.
 *
 * `createGlobalUniformGroup` builds the uniform group. Its pixi `Buffer` is created here rather
 * than at the first upload, so it can be kept out of the renderer GC before a render bundle bakes
 * it.
 *
 * Every binding starts with a placeholder (the bone pit with the view's own buffer), so the group
 * is valid before the first frame. `View3DPipeGpu` sets `uBrdfLutTexture` once the view has an
 * environment, `uEnvironmentTexture` when that environment is a cubemap, and `uMaterialStorage`,
 * `uBonePitStorage`, `uMorphStorage` and `uGeometryStorage` every frame. The forward passes set
 * `uRenderableStorage`, `uRenderableInstanceStorage` and `uInstanceStorage` per batch, and the
 * shadow pass sets the first two per batch as well. The data's `globalTextureBindings` names
 * `uShadowMap` for the shadow pass and `uOpaqueDepthTexture` and `uOpaqueColorTexture` for the
 * render graph, the same names as on WebGL. `uShadowMap` holds the shadow pass's current map, or the
 * placeholder when it has none and while it draws into the map.
 * @param view3d - The View3D instance to get or create the global WebGPU data for.
 * @param renderer - The renderer whose data on the View is read.
 * @returns The renderer's global data on the View.
 * @internal
 */
export function getGlobalGpuData(view3d: View3D, renderer: WebGPURenderer): View3DGlobalData {
  let data = view3d._gpuData[renderer.uid];
  if (!data) {
    const globalUniformGroup = createGlobalUniformGroup(view3d._lightDataList.data, view3d._shadowDataList.data);

    renderer.ubo.ensureUniformGroup(globalUniformGroup);
    globalUniformGroup.buffer!.autoGarbageCollect = false;

    const style = new TextureStyle();
    style.addressMode = 'repeat';

    const shadowStyle = new TextureStyle();
    shadowStyle.compare = 'less';

    /** `transmissionBit` also blurs the opaque copy through this sampler, so it needs linear mip filtering */
    const brdfLutStyle = new TextureStyle();
    brdfLutStyle.addressMode = 'clamp-to-edge';

    const group = new BindGroup({
      global: globalUniformGroup,
      uSampler: style,
      uEnvironmentTexture: CUBETEXTURE_EMPTY.source,
      uBrdfLutTexture: Texture.EMPTY.source,
      uBrdfLutSampler: brdfLutStyle,
      uShadowMap: DEPTH_EMPTY.source,
      uShadowSampler: shadowStyle,
      uOpaqueDepthTexture: DEPTH_VIEW_PLACEHOLDER,
      uOpaqueColorTexture: Texture.EMPTY.source,
      uMaterialStorage: UINT_EMPTY.source,
      uRenderableStorage: EMPTY_BUFFER_RESOURCE,
      uRenderableInstanceStorage: EMPTY_BUFFER_RESOURCE,
      uBonePitStorage: view3d._bonePit.bufferResource,
      uMorphStorage: EMPTY_BUFFER_RESOURCE,
      uGeometryStorage: EMPTY_BUFFER_RESOURCE,
      uInstanceStorage: EMPTY_BUFFER_RESOURCE,
    });

    data = new View3DGlobalData(globalUniformGroup, group, {
      opaqueColor: { group, slot: 'uOpaqueColorTexture' },
      opaqueDepth: { group, slot: 'uOpaqueDepthTexture' },
      shadowMap: { group, slot: 'uShadowMap' },
    });
    view3d._gpuData[renderer.uid] = data;
  }
  return data;
}
