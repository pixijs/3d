import { glTexelAddress } from '../../buffers/dataTextureLayout';
import { MESH3D_LANE_PREVIOUS_MORPH_WEIGHT } from '../../buffers/Mesh3DDataStoreBuffer';
import { fetchStoreLaneGl } from '../../shader/bits/instanceFetchBitGl';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * The GLSL twin of `createMorphTargetBitGpu`. Reads `morphData` (weight offset, geometry row) from
 * `instanceFetchBitGl`, and that row's morph texel from `GeometryDataStoreBuffer`. The `previous` form morphs
 * `previousPosition` alone, with the stride its geometry's normals set, and the material system adds it after its
 * twin, whose helpers it calls.
 */
function createMorphTargetBitGl(hasNormals: boolean, previous = false): ShaderBit {
  const step = hasNormals ? ' * 2' : '';
  const target = previous ? 'previousPosition' : 'position';
  const weightIndex = previous ? `float(${fetchStoreLaneGl(MESH3D_LANE_PREVIOUS_MORPH_WEIGHT)})` : 'morphData.x';
  const deformNormals = hasNormals && !previous;

  const input = `
        if (${weightIndex} != 0.0) {
          uvec4 morphFacts = fetchGeometryMorphFacts(int(morphData.y));
          int morphTargetCount = int(morphFacts.y);
          int vidLocal = gl_VertexID - int(morphFacts.z);
          int morphDeltaTexel = int(morphFacts.x) / 4 + vidLocal * morphTargetCount${step};
          int morphWeightIndex = int(${weightIndex});
          vec3 morphedPosition = ${target}.xyz;${deformNormals ? '\n          vec3 morphedNormal = normal;' : ''}
          for (int morphIndex = 0; morphIndex < morphTargetCount; morphIndex++) {
            float morphWeight = fetchMorphWeight(morphWeightIndex + morphIndex);
            if (morphWeight != 0.0) {
              morphedPosition += fetchMorphTexel(morphDeltaTexel + morphIndex${step}).xyz * morphWeight;${
                deformNormals
                  ? '\n              morphedNormal += fetchMorphTexel(morphDeltaTexel + morphIndex * 2 + 1).xyz * morphWeight;'
                  : ''
              }
            }
          }
          ${target} = vec4(morphedPosition, ${target}.w);${deformNormals ? '\n          normal = normalize(morphedNormal);' : ''}
        }
      `;

  if (previous) {
    return {
      name: hasNormals ? 'previousMorphTargetNormalGl' : 'previousMorphTargetGl',
      gl: { vertex: { input } },
    };
  }

  return {
    name: hasNormals ? 'morphTargetNormalGl' : 'morphTargetGl',
    bindings: {
      global: {
        uMorphTexture: 'texture_2d<f32>',
        uGeometryTexture: 'texture_2d<u32>',
      },
    },
    gl: {
      vertex: {
        header: `
        vec4 fetchMorphTexel(int texel) {
          return texelFetch(uMorphTexture, ${glTexelAddress('texel')}, 0);
        }

        float fetchMorphWeight(int index) {
          return fetchMorphTexel(index >> 2)[index & 3];
        }

        uvec4 fetchGeometryMorphFacts(int geometryIndex) {
          int texel = geometryIndex * 2 + 1;
          return texelFetch(uGeometryTexture, ${glTexelAddress('texel')}, 0);
        }
      `,
        input,
      },
    },
  };
}

/** @internal */
export const morphTargetBitGl: ShaderBit = createMorphTargetBitGl(false);

/** @internal */
export const morphTargetNormalBitGl: ShaderBit = createMorphTargetBitGl(true);

/** @internal */
export const previousMorphTargetBitGl: ShaderBit = createMorphTargetBitGl(false, true);

/** @internal */
export const previousMorphTargetNormalBitGl: ShaderBit = createMorphTargetBitGl(true, true);
