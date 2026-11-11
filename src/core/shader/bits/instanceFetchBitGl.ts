import { glTexelAddress } from '../../buffers/dataTextureLayout';
import {
  MESH3D_LANE_BONES,
  MESH3D_LANE_GEOMETRY,
  MESH3D_LANE_MATERIAL,
  MESH3D_LANE_MORPH_WEIGHT,
  MESH3D_STORE_STRIDE,
} from '../../buffers/Mesh3DDataStoreBuffer';
import type { ShaderBit } from '../ShaderBit';

const TEXELS_PER_ROW = MESH3D_STORE_STRIDE / 4;

const COMPONENT = ['x', 'y', 'z', 'w'];
const at = (lane: number) => ({ texel: lane >> 2, component: COMPONENT[lane & 3] });

const BONES = at(MESH3D_LANE_BONES);
const GEOMETRY = at(MESH3D_LANE_GEOMETRY);
const MORPH = at(MESH3D_LANE_MORPH_WEIGHT);
const MATERIAL = at(MESH3D_LANE_MATERIAL);

/**
 * One fetch reads three lanes, which `Mesh3DDataStoreBuffer` keeps in one texel. `batchTransform`
 * stays out of the once-a-frame global block, since `Mesh3DBatcherGl` sets it per batch.
 */
function createInstanceFetchBitGl(material: boolean): ShaderBit {
  return {
    name: material ? 'instanceFetchMaterial' : 'instanceFetch',
    bindings: {
      global: {
        uMeshStoreTexture: 'texture_2d<u32>',
        uRenderInstanceTexture: 'texture_2d<u32>',
        batchTransform: {
          uBatchWorldMatrix: 'mat4x4<f32>',
        },
      },
    },
    gl: {
      vertex: {
        header: /* glsl */ `
      uniform int uInstanceBase;

      uvec4 fetchStoreTexel(int texel) {
        return texelFetch(uMeshStoreTexture, ${glTexelAddress('texel')}, 0);
      }
      `,
        input: /* glsl */ `
      int instanceSlot = uInstanceBase + gl_InstanceID;
      uvec4 renderInstance = texelFetch(uRenderInstanceTexture, ${glTexelAddress('instanceSlot')}, 0);

      int storeTexel = int(renderInstance.x) * ${TEXELS_PER_ROW};

      modelMatrix = uBatchWorldMatrix * mat4(
        uintBitsToFloat(fetchStoreTexel(storeTexel)),
        uintBitsToFloat(fetchStoreTexel(storeTexel + 1)),
        uintBitsToFloat(fetchStoreTexel(storeTexel + 2)),
        uintBitsToFloat(fetchStoreTexel(storeTexel + 3)));

      uvec4 indexLanes = fetchStoreTexel(storeTexel + ${BONES.texel});
      float bonePitIndex = float(indexLanes.${BONES.component});
      vec2 morphData = vec2(
        float(fetchStoreTexel(storeTexel + ${MORPH.texel}).${MORPH.component}),
        float(int(indexLanes.${GEOMETRY.component})));
      ${material ? `vMaterialIndex = indexLanes.${MATERIAL.component};` : ''}
      `,
      },
    },
  };
}

/**
 * Sets each instance's `modelMatrix` on WebGL, for a pass's own template that draws meshes
 *
 * List it in the pass descriptor's `bitsGl`. A material's shader fetches the same data already, so
 * listing it in a material's `descriptor` fails the compile. It fills the vertex template's
 * `{{input}}` slot with the matrix and the indices skinning and morphing read. WebGPU templates
 * read the same data themselves, so `bitsGpu` needs no counterpart.
 * @example
 * ```ts
 * const shaderDescriptor = {
 *   bitsGpu: [maskBit],
 *   bitsGl: [instanceFetchBitGl, maskBit],
 *   template: maskTemplate,
 * };
 * ```
 * @category rendering
 * @advanced
 */
export const instanceFetchBitGl: ShaderBit = createInstanceFetchBitGl(false);

/** @internal */
export const instanceFetchMaterialBitGl: ShaderBit = createInstanceFetchBitGl(true);
