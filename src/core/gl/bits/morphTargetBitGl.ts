import { glTexelAddress } from '../../buffers/dataTextureLayout';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Blend-shape deformation for WebGL, the GLSL twin of `createMorphTargetBitGpu`, which documents
 * the algorithm: where it runs, the delta layout, the zero offset and zero weight skips, and the
 * atlas base vertex
 *
 * WebGL has no storage buffers, so both stores arrive as data textures read with `texelFetch`:
 *
 * - `uMorphTexture` is the shared morph store (`rgba32float`). A delta is one texel. A weight is one
 *   float, at texel `i >> 2`, channel `i & 3`.
 * - `uGeometryTexture` is the geometry data store (`rgba32uint`). Texel 1 of the geometry's row
 *   holds its delta base (in floats), target count and atlas base vertex.
 *
 * `morphData` comes from `instanceFetchBitGl`: `.x` is the mesh's weight offset and `.y` its
 * geometry row. The vertex index is `gl_VertexID`.
 * @param hasNormals - Whether each target also has a normal delta, taking two texels per target
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

/**
 * Blend-shape deformation of positions, for a morphed mesh whose geometry has no normal deltas
 * @internal
 */
export const morphTargetBitGl: ShaderBit = createMorphTargetBitGl(false);

/**
 * Blend-shape deformation that also applies normal deltas, for geometry with `hasMorphNormals`
 * @internal
 */
export const morphTargetNormalBitGl: ShaderBit = createMorphTargetBitGl(true);
