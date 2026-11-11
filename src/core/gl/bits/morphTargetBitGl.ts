import { glTexelAddress } from '../../buffers/dataTextureLayout';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * The GLSL twin of `createMorphTargetBitGpu`. Reads `morphData` (weight offset, geometry row) from
 * `instanceFetchBitGl`, and that row's morph texel from `GeometryDataStoreBuffer`.
 */
function createMorphTargetBitGl(hasNormals: boolean): ShaderBit {
  const step = hasNormals ? ' * 2' : '';

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
        input: `
        if (morphData.x != 0.0) {
          uvec4 morphFacts = fetchGeometryMorphFacts(int(morphData.y));
          int morphTargetCount = int(morphFacts.y);
          int vidLocal = gl_VertexID - int(morphFacts.z);
          int morphDeltaTexel = int(morphFacts.x) / 4 + vidLocal * morphTargetCount${step};
          int morphWeightIndex = int(morphData.x);
          vec3 morphedPosition = position.xyz;${hasNormals ? '\n          vec3 morphedNormal = normal;' : ''}
          for (int morphIndex = 0; morphIndex < morphTargetCount; morphIndex++) {
            float morphWeight = fetchMorphWeight(morphWeightIndex + morphIndex);
            if (morphWeight != 0.0) {
              morphedPosition += fetchMorphTexel(morphDeltaTexel + morphIndex${step}).xyz * morphWeight;${
                hasNormals
                  ? '\n              morphedNormal += fetchMorphTexel(morphDeltaTexel + morphIndex * 2 + 1).xyz * morphWeight;'
                  : ''
              }
            }
          }
          position = vec4(morphedPosition, position.w);${hasNormals ? '\n          normal = normalize(morphedNormal);' : ''}
        }
      `,
      },
    },
  };
}

/** @internal */
export const morphTargetBitGl: ShaderBit = createMorphTargetBitGl(false);

/** @internal */
export const morphTargetNormalBitGl: ShaderBit = createMorphTargetBitGl(true);
