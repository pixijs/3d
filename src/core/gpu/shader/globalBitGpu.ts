import { BindGroup, Texture, TextureStyle, UniformGroup } from 'pixi.js';
import type { WebGPURenderer } from 'pixi.js';

import type { View3D } from '../../../scene/View3D';
import { View3DGlobalData } from '../../../scene/View3DGlobalData';
import { EMPTY_BUFFER_RESOURCE } from '../../buffers/emptyBufferResource';
import {
  RenderableStruct,
  RenderableInstanceStruct,
  BoneMatrixStruct,
  GeometryDataStruct,
  LightStructGpu,
  ShadowDataStructGpu,
} from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';
import { CUBETEXTURE_EMPTY, DEPTH_EMPTY, DEPTH_VIEW_PLACEHOLDER } from '../../textures/DefaultTextures';

/**
 * WebGPU ShaderBit defining the global bind group layout for the 3D scene
 *
 * All 3D shaders share this single bind group (group 0). It provides the view's
 * lighting parameters, fog, and every GPU resource the batched pipeline needs.
 * The camera's lanes live in their own group at 1 (`cameraBit`), so a draw can
 * bind another camera against the same globals. The binding indices below must
 * stay in sync with the BindGroup created in `getGlobalGpuData`.
 *
 * ### Bind group layout (group 0)
 *
 * | Binding | Name                            | Type                      |
 * |---------|---------------------------------|---------------------------|
 * | 0       | uniform struct                  | fog, light params, time   |
 * | 1       | uSampler                        | sampler                   |
 * | 2       | uEnvironmentTexture             | texture_cube<f32>         |
 * | 3       | uBrdfLutTexture                 | texture_2d<f32>           |
 * | 4       | uBrdfLutSampler                 | sampler                   |
 * | 5       | uShadowMap                      | texture_depth_2d_array    |
 * | 6       | uShadowSampler                  | sampler_comparison        |
 * | 7       | uOpaqueDepthTexture             | texture_depth_2d          |
 * | 8       | uOpaqueColorTexture             | texture_2d<f32>           |
 * | 9       | uLightStorage                   | storage<Light>            |
 * | 10      | uShadowStorage                  | storage<ShadowData>       |
 * | 11      | uRenderableStorage              | storage<Renderable>       |
 * | 12      | uRenderableInstanceStorage      | storage<RenderableInstance> (id + packed texture slots) |
 * | 13      | uBonePitStorage                 | storage<BoneMatrix>       |
 * | 14      | uMorphStorage                   | storage<f32>       (shared morph deltas + weights)   |
 * | 15      | uGeometryStorage                | storage<GeometryData> (per-geometry sphere + morph facts) |
 * | 16      | uMaterialStorage                | storage<Material>  (from materialStorageBindingBit) |
 *
 * Group 0 holds eight storage buffers (9–16). WebGPU caps
 * `maxStorageBuffersPerShaderStage` at 8, so leaving every binding
 * `VERTEX | FRAGMENT` would sit exactly at the ceiling in *both* stages. Each
 * storage buffer is instead tagged (in the `bindings` block below) with the
 * stage that reads it, splitting that shared ceiling into two budgets:
 * **vertex 6** {11 renderable, 12 instance, 13 bones, 14 morph, 15 geometry,
 * 16 material} · **fragment 3** {9 lights, 10 shadows, 16 material}. Material is
 * the only both-stage buffer. That leaves room to add buffers per stage.
 * Morph deltas and weights deliberately share `uMorphStorage` rather than
 * taking two slots.
 *
 * **uOpaqueDepthTexture (binding 7)** — A copy of the opaque pass's depth
 * buffer, produced by `CopyDepthPass`. Bound by the graph's auto-bind path
 * for consumers that declare `b.sample(opaqueDepthHandle, 7)`. Initialised
 * with the shared 1×1 `DEPTH_VIEW_PLACEHOLDER` so the bind-group
 * layout is valid before any consumer-bearing frame runs.
 *
 * **uOpaqueColorTexture (binding 8)** — A copy of the opaque pass's colour
 * buffer, produced by `CopyOpaquePass`. Bound by auto-bind for consumers
 * that declare `b.sample(opaqueColorHandle, 8)` (transmission, blended-
 * refraction). Initialised with a 1×1 placeholder (`Texture.EMPTY`).
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
    ShadowData: ShadowDataStructGpu,
  },
  bindings: {
    global: {
      uGlobalLightParams: 'vec4<f32>',
      uTime: 'f32',
      uFogColor: 'vec3<f32>', // Linear fog color, premultiplied by uExposure
      uFogParams: 'vec3<f32>', // (x: near, y: far, z: density). Linear reads x,y; exp/exp2 read z.
      uExposure: 'f32', // Linear scene-radiance multiplier applied before tone-mapping
      // Hemisphere fill — populated when `view3d.environment` is a
      // Hemisphere, zero otherwise. Sky/ground are premultiplied by
      // intensity on the CPU side; `up` is normalised.
      uHemisphereSky: 'vec3<f32>',
      uHemisphereGround: 'vec3<f32>',
      uHemisphereUp: 'vec3<f32>',
      // --- textures & samplers (bindings 1–8) ---
      uSampler: 'sampler',
      uEnvironmentTexture: 'texture_cube<f32>',
      uBrdfLutTexture: 'texture_2d<f32>',
      uBrdfLutSampler: 'sampler',
      uShadowMap: 'texture_depth_2d_array',
      uShadowSampler: 'sampler_comparison',
      uOpaqueDepthTexture: 'texture_depth_2d',
      uOpaqueColorTexture: 'texture_2d<f32>',

      // --- storage buffers (bindings 9–15; material at 16 via materialStorageBindingBit) ---
      // Per-stage visibility narrows each buffer to the stage(s) that read it, so
      // it counts against only that stage's maxStorageBuffersPerShaderStage budget
      // (see the header table). Lighting/shadowing are fragment; the renderable +
      // instance rows, bones, morph, and geometry facts are read only in the
      // vertex transform. uMaterialStorage (16) is read in BOTH stages, so it
      // keeps the default 'both' (declared by materialStorageBindingBit).
      uLightStorage: { type: `storage<Light>`, visibility: 'fragment' },
      uShadowStorage: { type: `storage<ShadowData>`, visibility: 'fragment' },
      uRenderableStorage: { type: `storage<Renderable>`, visibility: 'vertex' },
      uRenderableInstanceStorage: { type: `storage<RenderableInstance>`, visibility: 'vertex' },
      uBonePitStorage: { type: `storage<BoneMatrix>`, visibility: 'vertex' },
      uMorphStorage: { type: `storage<f32>`, visibility: 'vertex' },
      uGeometryStorage: { type: `storage<GeometryData>`, visibility: 'vertex' },
    },
  },
  gpu: {
    // Named constants for the numeric `light.kind` enum. Live on globalBitGpu so
    // they're declared once per shader regardless of how many bits read
    // `Light.kind` (factory-produced lighting bits, user-written effect bits,
    // debug overlays, etc.). Values match the encoding in `LightDataListBuffer`.
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
 * @param view3d - The View3D instance to get or create the global WebGPU data for.
 * @param renderer - The renderer whose slot on the View is read.
 * @returns The renderer's global data on the View.
 * @internal
 */
export function getGlobalGpuData(view3d: View3D, renderer: WebGPURenderer): View3DGlobalData {
  let data = view3d._gpuData[renderer.uid];
  if (!data) {
    const globalUniformGroup = new UniformGroup({
      uGlobalLightParams: {
        value: new Float32Array([0, 0, 0, 0]),
        type: 'vec4<f32>',
      },
      uTime: { value: 0, type: 'f32' },
      // Written by View3DPipe as linear light premultiplied by exposure, so
      // the fog bits can mix in the same space the lit colour is already in
      // and the tone curve then shapes fog and scene together.
      uFogColor: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uFogParams: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uExposure: { value: 1, type: 'f32' },
      uHemisphereSky: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uHemisphereGround: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uHemisphereUp: { value: new Float32Array([0, 1, 0]), type: 'vec3<f32>' },
    });

    globalUniformGroup.isStatic = true;
    globalUniformGroup.ubo = false;

    // Realize the group's GPU buffer now (pixi would otherwise create it at
    // first upload) so it can be exempted from the renderer GC before any
    // render bundle bakes a reference to it.
    renderer.ubo.ensureUniformGroup(globalUniformGroup);
    globalUniformGroup.buffer!.autoGarbageCollect = false;

    const style = new TextureStyle();
    style.addressMode = 'repeat';

    const shadowStyle = new TextureStyle();
    shadowStyle.compare = 'less';

    const brdfLutStyle = new TextureStyle();
    brdfLutStyle.addressMode = 'clamp-to-edge';

    const globalBindGroup = new BindGroup({
      0: globalUniformGroup, // uniform struct (fog, lights, time)
      1: style, // uSampler
      2: CUBETEXTURE_EMPTY.source, // uEnvironmentTexture
      3: Texture.EMPTY.source, // uBrdfLutTexture
      4: brdfLutStyle, // uBrdfLutSampler
      5: DEPTH_EMPTY.source, // uShadowMap
      6: shadowStyle, // uShadowSampler
      7: DEPTH_VIEW_PLACEHOLDER, // uOpaqueDepthTexture (placeholder)
      8: Texture.EMPTY.source, // uOpaqueColorTexture (placeholder)
      9: view3d._lightDataBuffer.bufferResource, // uLightStorage
      10: view3d._shadowDataBuffer.bufferResource, // uShadowStorage
      11: EMPTY_BUFFER_RESOURCE, // uRenderableStorage (set per batch)
      12: EMPTY_BUFFER_RESOURCE, // uRenderableInstanceStorage (set per batch)
      13: view3d._bonePit.bufferResource, // uBonePitStorage
      14: EMPTY_BUFFER_RESOURCE, // uMorphStorage (shared morph store, set per frame)
      15: EMPTY_BUFFER_RESOURCE, // uGeometryStorage (shared geometry data store, set per frame)
      16: EMPTY_BUFFER_RESOURCE, // uMaterialStorage (set per frame)
    });

    data = new View3DGlobalData(globalUniformGroup, globalBindGroup);
    view3d._gpuData[renderer.uid] = data;
  }
  return data;
}
