import { BindGroup, Texture, TextureStyle } from 'pixi.js';
import type { WebGPURenderer } from 'pixi.js';

import { MAX_LIGHTS } from '../../../scene/View3D';
import type { View3D } from '../../../scene/View3D';
import { View3DGlobalData } from '../../../scene/View3DGlobalData';
import { EMPTY_BUFFER_RESOURCE } from '../../buffers/emptyBufferResource';
import { createGlobalUniformGroup } from '../../GlobalUniformGroup';
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
 * The scene globals every WebGPU 3D shader binds at group 0: the view's lights, fog and exposure,
 * and every texture and buffer the batched draws read
 *
 * The camera has its own group at 1 (`cameraBit`), so a draw can bind another camera against the
 * same globals. The uniform members share binding 0; the textures and samplers follow in
 * declaration order, then the storage buffers. Two things must match this bit: the `BindGroup`
 * indices in `getGlobalGpuData`, and the key order of the group `createGlobalUniformGroup` builds,
 * since pixi lays the uniform buffer out in key order while the shader reads the struct in
 * declaration order.
 *
 * | Binding | Name                       | Type                                                      |
 * |---------|----------------------------|-----------------------------------------------------------|
 * | 0       | uniform struct             | light params, time, fog, exposure, hemisphere, light list, shadow slots |
 * | 1       | uSampler                   | sampler                                                   |
 * | 2       | uEnvironmentTexture        | texture_cube<f32>                                         |
 * | 3       | uBrdfLutTexture            | texture_2d<f32>                                           |
 * | 4       | uBrdfLutSampler            | sampler                                                   |
 * | 5       | uShadowMap                 | texture_depth_2d_array                                    |
 * | 6       | uShadowSampler             | sampler_comparison                                        |
 * | 7       | uOpaqueDepthTexture        | texture_depth_2d                                          |
 * | 8       | uOpaqueColorTexture        | texture_2d<f32>                                           |
 * | 9       | uMaterialStorage           | texture_2d<u32> (the material store's rows)               |
 * | 10      | uRenderableStorage         | storage<Renderable>                                       |
 * | 11      | uRenderableInstanceStorage | storage<RenderableInstance> (id + packed texture slots)   |
 * | 12      | uBonePitStorage            | storage<BoneMatrix>                                       |
 * | 13      | uMorphStorage              | storage<f32> (morph deltas + weights)                     |
 * | 14      | uGeometryStorage           | storage<GeometryData> (per-geometry sphere + morph facts) |
 *
 * WebGPU's default `maxStorageBuffersPerShaderStage` is 8, and the five storage buffers here
 * already use five. They are read only by the vertex transform, so each is tagged `'vertex'` and
 * counts against the vertex budget alone, leaving the fragment stage's budget empty. The material
 * rows are a data texture rather than a sixth buffer; `materialTextureAccessPlugin` says why.
 * Morph deltas and weights share one buffer for the same reason.
 *
 * The light list and the shadow slots sit in the uniform struct, where WebGL reads them too: each
 * is small, capped and read-only.
 *
 * `uOpaqueDepthTexture` and `uOpaqueColorTexture` are the copies `CopyDepthPass` and
 * `CopyOpaquePass` make of the opaque pass's output. The render graph binds them for passes that
 * declare `b.sample(handle, pipe.globalSlots.opaqueDepth)` or `.opaqueColor`, such as transmission
 * and blended refraction. Until then they hold 1×1 placeholders, so the layout is valid from the
 * first frame.
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
      /**
       * Ambient light in `xyz`, linear and premultiplied by intensity
       *
       * `LightingSystemGpu` also writes the light count into `w` every frame, but no shader reads
       * it: the light loop walks the light-tile masks instead.
       */
      uGlobalLightParams: 'vec4<f32>',
      uTime: 'f32',
      /** Linear fog colour, premultiplied by `uExposure`, so fog mixes in the same space as the lit colour */
      uFogColor: 'vec3<f32>',
      /** Fog `(near, far, density)`: linear fog reads `x` and `y`, exponential fog reads `z` */
      uFogParams: 'vec3<f32>',
      /** Linear multiplier on the scene's light, applied before tone mapping */
      uExposure: 'f32',
      /**
       * Hemisphere sky colour, linear and premultiplied by intensity
       *
       * `LightingSystemGpu` writes the three hemisphere members only while the view's environment is
       * a `Hemisphere`. Under any other environment no bit reads them, and they keep stale values.
       */
      uHemisphereSky: 'vec3<f32>',
      /** Hemisphere ground colour, linear and premultiplied by intensity */
      uHemisphereGround: 'vec3<f32>',
      /** Hemisphere up direction, normalized */
      uHemisphereUp: 'vec3<f32>',
      /**
       * The packed light list, four `vec4` per light as `LightDataList` lays them out
       *
       * Entries at and above the light count are stale; the light-tile masks never select them.
       */
      uLightData: `array<vec4<f32>, ${MAX_LIGHTS * 4}>`,
      /** One shadow slot per light and cascade, six `vec4` each as `ShadowDataList` lays them out */
      uShadowData: `array<vec4<f32>, ${MAX_SHADOW_SLOTS * 6}>`,
      /**
       * The one sampler every batch texture and the environment cube sample through, with `repeat`
       * addressing
       *
       * The batch group holds textures only, so a texture's own `TextureStyle` has no effect here;
       * WebGL samples each texture with its own style.
       */
      uSampler: 'sampler',
      uEnvironmentTexture: 'texture_cube<f32>',
      uBrdfLutTexture: 'texture_2d<f32>',
      uBrdfLutSampler: 'sampler',
      uShadowMap: 'texture_depth_2d_array',
      uShadowSampler: 'sampler_comparison',
      uOpaqueDepthTexture: 'texture_depth_2d',
      uOpaqueColorTexture: 'texture_2d<f32>',
      /**
       * The material store's rows, read in both stages through the `getMaterial()`
       * `materialTextureAccessPlugin` generates; the `u32` texel type hands the shader exact bits
       */
      uMaterialStorage: 'texture_2d<u32>',

      uRenderableStorage: { type: `storage<Renderable>`, visibility: 'vertex' },
      uRenderableInstanceStorage: { type: `storage<RenderableInstance>`, visibility: 'vertex' },
      uBonePitStorage: { type: `storage<BoneMatrix>`, visibility: 'vertex' },
      uMorphStorage: { type: `storage<f32>`, visibility: 'vertex' },
      uGeometryStorage: { type: `storage<GeometryData>`, visibility: 'vertex' },
    },
  },
  /** Names for the `Light.kind` values `LightDataList` writes, declared once here for every bit that reads them */
  gpu: {
    header: /*wgsl*/ `
const LIGHT_DIRECTIONAL: f32 = 0.0;
const LIGHT_POINT: f32 = 1.0;
const LIGHT_SPOT: f32 = 2.0;
`,
  },
};

/**
 * This renderer's global data on the View3D, minted on first use
 *
 * Lives in the View's `_gpuData` slot for the renderer, which is also the View's payload in
 * pixi's renderer GC: pixi clears the slot when the View unloads or the renderer is destroyed,
 * and the next call mints a fresh one.
 *
 * `createGlobalUniformGroup` builds the uniform group. Its pixi `Buffer` is created here rather
 * than at the first upload, so it can be kept out of the renderer GC before a render bundle bakes
 * it.
 *
 * Every binding starts with a placeholder (the bone pit with the view's own buffer), so the group
 * is valid before the first frame. `View3DPipeGpu` sets 3 once the view has an environment, 2
 * when that environment is a cubemap, and 9 and 12 to 14 every frame. The forward passes set 10
 * and 11 per batch, the shadow pass sets 5, and the render graph sets 7 and 8.
 * @param view3d - The View3D instance to get or create the global WebGPU data for.
 * @param renderer - The renderer whose slot on the View is read.
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

    const brdfLutStyle = new TextureStyle();
    brdfLutStyle.addressMode = 'clamp-to-edge';

    const globalBindGroup = new BindGroup({
      0: globalUniformGroup,
      1: style,
      2: CUBETEXTURE_EMPTY.source,
      3: Texture.EMPTY.source,
      4: brdfLutStyle,
      5: DEPTH_EMPTY.source,
      6: shadowStyle,
      7: DEPTH_VIEW_PLACEHOLDER,
      8: Texture.EMPTY.source,
      9: UINT_EMPTY.source,
      10: EMPTY_BUFFER_RESOURCE,
      11: EMPTY_BUFFER_RESOURCE,
      12: view3d._bonePit.bufferResource,
      13: EMPTY_BUFFER_RESOURCE,
      14: EMPTY_BUFFER_RESOURCE,
    });

    data = new View3DGlobalData(globalUniformGroup, globalBindGroup);
    view3d._gpuData[renderer.uid] = data;
  }
  return data;
}
