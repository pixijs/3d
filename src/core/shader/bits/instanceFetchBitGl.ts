import { glTexelAddress } from '../../buffers/dataTextureLayout';
import {
  MESH3D_LANE_BONES,
  MESH3D_LANE_GEOMETRY,
  MESH3D_LANE_MATERIAL,
  MESH3D_LANE_MORPH_WEIGHT,
  MESH3D_STORE_STRIDE,
} from '../../buffers/Mesh3DDataStoreBuffer';
import type { ShaderBit } from '../ShaderBit';

/** The texels in one mesh store row, which is `MESH3D_STORE_STRIDE` words long */
const TEXELS_PER_ROW = MESH3D_STORE_STRIDE / 4;

const COMPONENT = ['x', 'y', 'z', 'w'];
/**
 * The texel within the row that holds `lane`, and the component within that texel
 * @param lane - Word index within the store row
 */
const at = (lane: number) => ({ texel: lane >> 2, component: COMPONENT[lane & 3] });

const BONES = at(MESH3D_LANE_BONES);
const GEOMETRY = at(MESH3D_LANE_GEOMETRY);
const MORPH = at(MESH3D_LANE_MORPH_WEIGHT);
const MATERIAL = at(MESH3D_LANE_MATERIAL);

/**
 * Builds one variant of the fetch
 *
 * The two textures are declared here rather than on the global bits, so only templates whose
 * passes fetch carry them.
 *
 * The fetch reads the bone, geometry and material lanes out of one texel, the one that holds the
 * bone lane, so those three lanes of the mesh store row must share a texel; lanes 16 to 18 do. The
 * morph weight lane sits in the next texel and takes a fetch of its own.
 * @param material - Adds the material index and texture-slot varyings the forward shader's fragment stage reads
 */
function createInstanceFetchBitGl(material: boolean): ShaderBit {
  return {
    name: material ? 'instanceFetchMaterial' : 'instanceFetch',
    bindings: {
      global: {
        uMeshStoreTexture: 'texture_2d<u32>',
        uRenderInstanceTexture: 'texture_2d<u32>',
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
      ${
        material
          ? `vMaterialIndex = indexLanes.${MATERIAL.component};
      vTextureSlots = renderInstance.y;`
          : ''
      }
      `,
      },
    },
  };
}

/**
 * Reads each instance's world matrix and per-mesh indices on WebGL, for a template that draws
 * meshes
 *
 * List it in a descriptor's `bitsGl`. It sets the vertex template's `modelMatrix` in the
 * `{{input}}` slot, and declares the `bonePitIndex` and `morphData` locals that the skinning and
 * morph bits read. WebGPU templates read the same data from storage buffers in the global bind
 * group, so the WebGPU list needs no counterpart.
 *
 * It takes two hops, as WebGPU does with its storage buffers. The pass's index texture names a mesh
 * store row, and the row holds the world matrix and the bone, geometry and morph lanes:
 *
 * ```text
 * uInstanceBase + gl_InstanceID  ->  index texel  ->  store row  ->  mat4 + lanes
 * ```
 *
 * Because the row is addressed by a computed index rather than by attribute pointers, a draw
 * needs no per-command vertex state: `uInstanceBase` carries what WebGL2 has no `baseInstance`
 * for. Both textures are integer formats, so every lane arrives bit-exact: the store's matrix
 * lanes come back through `uintBitsToFloat`, and the integer lanes read directly.
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

/**
 * The main pass's {@link instanceFetchBitGl}, which also passes `vMaterialIndex` and
 * `vTextureSlots` to the fragment stage
 * @internal
 */
export const instanceFetchMaterialBitGl: ShaderBit = createInstanceFetchBitGl(true);
