import { glTexelAddress } from '../../buffers/dataTextureLayout';
import {
  MESH3D_LANE_BONES,
  MESH3D_LANE_GEOMETRY,
  MESH3D_LANE_MATERIAL,
  MESH3D_LANE_MORPH_WEIGHT,
  MESH3D_STORE_STRIDE,
} from '../../buffers/Mesh3DDataStoreBuffer';
import type { ShaderBit } from '../ShaderBit';

/** Store rows are `MESH3D_STORE_STRIDE` words, so this many texels per row */
const TEXELS_PER_ROW = MESH3D_STORE_STRIDE / 4;

const COMPONENT = ['x', 'y', 'z', 'w'];
/**
 * `lane` → the texel offset within the row, and the component within that texel
 * @param lane - Word index within the store row
 */
const at = (lane: number) => ({ texel: lane >> 2, component: COMPONENT[lane & 3] });

const BONES = at(MESH3D_LANE_BONES);
const GEOMETRY = at(MESH3D_LANE_GEOMETRY);
const MORPH = at(MESH3D_LANE_MORPH_WEIGHT);
const MATERIAL = at(MESH3D_LANE_MATERIAL);

/**
 * Builds one variant of the fetch
 * @param material - Adds the material index and texture-slot varyings the forward shader's fragment stage reads
 */
function createInstanceFetchBitGl(material: boolean): ShaderBit {
  return {
    name: material ? 'instanceFetchMaterial' : 'instanceFetch',
    bindings: {
      global: {
        // Declared here rather than on the global bits so only templates whose
        // passes actually fetch carry them.
        uMeshStoreTexture: 'texture_2d<f32>',
        uRenderInstanceTexture: 'texture_2d<f32>',
      },
    },
    gl: {
      vertex: {
        header: /* glsl */ `
      uniform int uInstanceBase;

      vec4 fetchStoreTexel(int texel) {
        return texelFetch(uMeshStoreTexture, ${glTexelAddress('texel')}, 0);
      }
      `,
        input: /* glsl */ `
      int instanceSlot = uInstanceBase + gl_InstanceID;
      vec4 renderInstance = texelFetch(uRenderInstanceTexture, ${glTexelAddress('instanceSlot')}, 0);

      int storeTexel = int(renderInstance.x) * ${TEXELS_PER_ROW};

      modelMatrix = uBatchWorldMatrix * mat4(
        fetchStoreTexel(storeTexel),
        fetchStoreTexel(storeTexel + 1),
        fetchStoreTexel(storeTexel + 2),
        fetchStoreTexel(storeTexel + 3));

      // One fetch serves three consumers: the bone pit index skinningBitGl reads,
      // the geometry row morphTargetBitGl reads, and this instance's material.
      vec4 indexLanes = fetchStoreTexel(storeTexel + ${BONES.texel});
      float bonePitIndex = float(floatBitsToUint(indexLanes.${BONES.component}));
      vec2 morphData = vec2(
        float(floatBitsToUint(fetchStoreTexel(storeTexel + ${MORPH.texel}).${MORPH.component})),
        float(int(floatBitsToUint(indexLanes.${GEOMETRY.component}))));
      ${
        material
          ? `vMaterialIndex = floatBitsToUint(indexLanes.${MATERIAL.component});
      // Recombined from two exact 16-bit halves — the raw u32's bit pattern can
      // be a NaN that a float texture fetch is allowed to canonicalise.
      vTextureSlots = (uint(renderInstance.z + 0.5) << 16) | uint(renderInstance.y + 0.5);`
          : ''
      }
      `,
      },
    },
  };
}

/**
 * The WebGL half of per-instance fetch, listed by mesh pass templates
 *
 * A mesh pass template lists this bit in `bitsGl` to receive `modelMatrix` in its vertex
 * `{{input}}` slot, plus the `bonePitIndex` and `morphData` locals the skinning and morph bits
 * read. WebGPU templates read the renderable storage buffers from the global bind group
 * directly, so there is no counterpart to list on that side today.
 *
 * Two hops, mirroring what the WebGPU path does with storage buffers. The pass's index texture
 * names a mesh store row, and the store row holds the world matrix and the bone / geometry /
 * morph lanes:
 *
 * ```ts
 * uInstanceBase + gl_InstanceID  ->  index texel  ->  store row  ->  mat4 + lanes
 * ```
 *
 * Because the row is addressed by a computed index rather than by attribute pointers, a draw
 * needs no per-command vertex state: `uInstanceBase` carries what WebGL2 has no `baseInstance`
 * for. Both textures are float-sampled. The matrix lanes read straight out; the tail lanes are
 * `u32` (packed for WGSL) sharing the same store, so they come back through `floatBitsToUint`.
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
 * Forward-pass variant of {@link instanceFetchBitGl}, which also publishes `vMaterialIndex`
 * and `vTextureSlots` for the fragment stage
 * @internal
 */
export const instanceFetchMaterialBitGl: ShaderBit = createInstanceFetchBitGl(true);
