import { BindGroup, Texture, UniformGroup } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';

import { Matrix4 } from '../../../math/matrix/Matrix4';
import { MAX_LIGHTS, FLOATS_PER_LIGHT } from '../../../scene/View3D';
import type { View3D } from '../../../scene/View3D';
import { View3DGlobalData } from '../../../scene/View3DGlobalData';
import { MAX_CASCADES } from '../../render-passes/shadow/csmUtils';
import { MAX_SHADOW_LIGHTS } from '../../render-passes/shadow/shadowPassUtils';
import { LightStructGl, ShadowDataStructGl } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';
import { CUBETEXTURE_EMPTY, DEPTH_EMPTY } from '../../textures/DefaultTextures';

/**
 * WebGL-specific ShaderBit that defines the global uniform struct and bindings for the 3D scene
 *
 * Unlike WebGPU, which uses storage buffers, WebGL relies on flat uniform arrays for light and
 * shadow data, while still exposing the same shared `uTime` global for custom shader animation.
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
      uGlobalLightParams: 'vec4<f32>', // xyz: ambient color, w: light count
      uTime: 'f32',
      uBatchWorldMatrix: 'mat4x4<f32>',
      uFogColor: 'vec3<f32>', // Linear fog color, premultiplied by uExposure
      uFogParams: 'vec3<f32>', // (x: near, y: far, z: density). Linear reads x,y; exp/exp2 read z.
      uExposure: 'f32', // Linear scene-radiance multiplier applied before tone-mapping
      // Hemisphere fill — populated when `view3d.environment` is a
      // Hemisphere, zero otherwise. Sky/ground are premultiplied by
      // intensity on the CPU side; `up` is normalised.
      uHemisphereSky: 'vec3<f32>',
      uHemisphereGround: 'vec3<f32>',
      uHemisphereUp: 'vec3<f32>',
      // WebGL-only light list (4 vec4 per light, matches LightDataListBuffer stride=16 floats).
      uLightData: `array<vec4<f32>, ${MAX_LIGHTS * 4}>`,
      // Shadow data for WebGL: 6 vec4 per cascade entry (4 matrix + 1 params + 1
      // splits), matching the WebGPU ShadowData 24-float layout. One entry per
      // (light, cascade) slot.
      uShadowData: `array<vec4<f32>, ${MAX_SHADOW_LIGHTS * MAX_CASCADES * 6}>`,

      // Mip count of the bound env cubemap (GLSL ES 3.00 lacks
      // textureQueryLevels()). Set by View3DGlPipe when an env cubemap is
      // bound; otherwise 0. Lives on the global uniform group so it's
      // available to any consumer regardless of which env-source bit is active.
      uEnvironmentMaxMipLevel: 'f32',
      uEnvironmentTexture: 'texture_cube<f32>',
      uBrdfLutTexture: 'texture_2d<f32>',
      uMaterialStorage: 'texture_2d<f32>',
      uShadowMap: 'texture_depth_2d_array',
      uBonePitTexture: 'texture_2d<f32>',
      // Note: uBonePitTexture is declared inline in skinningBit.gl.vertex.header when skinning is enabled
      uOpaqueDepthTexture: 'texture_2d<f32>',
      uOpaqueColorTexture: 'texture_2d<f32>',
      // Data-texture views of the shared morph store (delta arena + weight
      // slots) and geometry data store (sphere + morph facts) — the WebGL
      // transports for what WebGPU binds as storage buffers. Read only by the
      // GL morph bits.
      uMorphTexture: 'texture_2d<f32>',
      uGeometryTexture: 'texture_2d<f32>',
    },
  },
  gl: {
    // Named constants for the numeric `light.type` enum. Live on globalBitGl
    // so they're declared once per shader regardless of how many bits read
    // `Light.type`. Values match the encoding in `LightDataListBuffer`.
    header: /*glsl*/ `
const float LIGHT_DIRECTIONAL = 0.0;
const float LIGHT_POINT = 1.0;
const float LIGHT_SPOT = 2.0;
`,
  },
};

/**
 * This renderer's global data on the View3D, minted on first use
 *
 * Lives in the View's `_gpuData` slot for the renderer, which is also the View's payload in
 * pixi's renderer GC: pixi clears the slot when the View unloads or the renderer is destroyed,
 * and the next call mints a fresh one.
 * @param view3d - The View3D instance to get or create the global WebGL data for.
 * @param renderer - The renderer whose slot on the View is read.
 * @returns The renderer's global data on the View.
 * @internal
 */
export function getGlobalGlData(view3d: View3D, renderer: WebGLRenderer): View3DGlobalData {
  let data = view3d._gpuData[renderer.uid];
  if (!data) {
    const globalUniformGroupGl = new UniformGroup({
      uGlobalLightParams: {
        value: new Float32Array([0, 0, 0, 0]),
        type: 'vec4<f32>',
      },
      uTime: { value: 0, type: 'f32' },
      // See WebGPU counterpart — linear light, premultiplied by exposure.
      uFogColor: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uFogParams: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uExposure: { value: 1, type: 'f32' },
      uHemisphereSky: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uHemisphereGround: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uHemisphereUp: { value: new Float32Array([0, 1, 0]), type: 'vec3<f32>' },
      uBatchWorldMatrix: {
        value: new Matrix4(),
        type: 'mat4x4<f32>',
      },
      uLightData: {
        value: new Float32Array(MAX_LIGHTS * FLOATS_PER_LIGHT),
        type: 'vec4<f32>',
        size: MAX_LIGHTS * 4,
      },
      uEnvironmentMaxMipLevel: { value: 0, type: 'f32' },
      uShadowData: {
        value: new Float32Array(MAX_SHADOW_LIGHTS * MAX_CASCADES * 6 * 4),
        type: 'vec4<f32>',
        size: MAX_SHADOW_LIGHTS * MAX_CASCADES * 6,
      },
    });

    globalUniformGroupGl.isStatic = true;
    globalUniformGroupGl.ubo = false;

    // Slots follow `generateGroupMap`: the uniform struct at 0, then the texture bindings of
    // `globalBitGl` and `instanceFetchBitGl` in declaration order. Each placeholder is the kind
    // of texture its sampler reads, so a slot nothing has bound yet is still valid to sample.
    const globalBindGroupGl = new BindGroup({
      0: globalUniformGroupGl,
      1: CUBETEXTURE_EMPTY.source, // uEnvironmentTexture (set when the view has an IBL environment)
      2: Texture.EMPTY.source, // uBrdfLutTexture (set per frame)
      3: Texture.EMPTY.source, // uMaterialStorage (set per frame)
      // uShadowMap: the comparison-mode placeholder, which the shadow pass swaps for its live map
      // when it renders and restores when it releases the map.
      4: DEPTH_EMPTY.source,
      5: Texture.EMPTY.source, // uBonePitTexture (set per frame)
      6: Texture.EMPTY.source, // uOpaqueDepthTexture (transient, bound by the graph)
      7: Texture.EMPTY.source, // uOpaqueColorTexture (transient, bound by the graph)
      8: Texture.EMPTY.source, // uMorphTexture (set per frame)
      9: Texture.EMPTY.source, // uGeometryTexture (set per frame)
      10: Texture.EMPTY.source, // the batch mesh store texture (set per batch)
      11: Texture.EMPTY.source, // the pass instance-index texture (set per batch)
    });

    data = new View3DGlobalData(globalUniformGroupGl, globalBindGroupGl);
    view3d._gpuData[renderer.uid] = data;
  }
  return data;
}
