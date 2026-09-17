import { glTexelAddress } from '../../buffers/dataTextureLayout';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Blend-shape deformation for the WebGL backend — the GLSL twin of `morphTargetBitGpu`
 *
 * Sums `Σ delta_i × weight_i` into the vertex position — and, in the
 * `hasNormals` variant, the vertex normal — before the skinning bit runs.
 * The `hasNormals` flag bakes the arena stride
 * (one texel/target positions-only, two — position then normal — with normals)
 * and the extra normal fetch + renormalize. WebGL has no storage buffers, so
 * both stores arrive as rgba32float data textures read with `texelFetch` (the
 * `skinningBitGl` pattern):
 *
 * - `uMorphTexture` — the shared morph store: delta arena + weight slots.
 *   Deltas are whole texels; weights are individual floats (texel `i >> 2`,
 *   channel `i & 3`).
 * - `uGeometryTexture` — the geometry data store. Row texel 1 carries the
 *   per-geometry morph facts (delta base, target count, atlas base vertex) as
 *   u32 bit patterns, recovered with `floatBitsToUint`.
 *
 * Per-instance inputs ride the `morphData` local, published by `instanceFetchBitGl`
 * out of the mesh store row: `.x` = the mesh's weight offset
 * (0 = no morph state — real offsets start past the arena — gating the whole
 * block), `.y` = the geometry's store row. `gl_VertexID - baseVertex` recovers
 * the geometry-local vertex id, so atlased (index-rebased) morphed geometry
 * indexes its deltas correctly; non-atlased geometry has baseVertex 0.
 * Parked dials are exactly 0 and skip their fetch — the branch is
 * per-instance-uniform, so it costs a scalar compare at worst.
 * @param hasNormals - Whether the morph deltas carry normals, taking two texels per target
 */
function createMorphTargetBitGl(hasNormals: boolean): ShaderBit {
  const step = hasNormals ? ' * 2' : ''; // two texels per target (position, then normal) when normals ride along

  return {
    name: hasNormals ? 'morphTargetNormalGl' : 'morphTargetGl',
    bindings: {
      global: {
        uMorphTexture: 'texture_2d<f32>',
        uGeometryTexture: 'texture_2d<f32>',
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

        // Row texel 1 of the geometry data store: (deltaBase, targetCount,
        // baseVertex, spare) as u32 bit patterns in an f32 texture.
        vec4 fetchGeometryMorphFacts(int geometryIndex) {
          int texel = geometryIndex * 2 + 1;
          return texelFetch(uGeometryTexture, ${glTexelAddress('texel')}, 0);
        }
      `,
        input: `
        if (morphData.x != 0.0) {
          vec4 morphFacts = fetchGeometryMorphFacts(int(morphData.y));
          int morphTargetCount = int(floatBitsToUint(morphFacts.y));
          int vidLocal = gl_VertexID - int(floatBitsToUint(morphFacts.z));
          int morphDeltaTexel = int(floatBitsToUint(morphFacts.x)) / 4 + vidLocal * morphTargetCount${step};
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
 * Positions-only blend-shape deformation (`geometry.morphTargetCount > 0`)
 * @internal
 */
export const morphTargetBitGl: ShaderBit = createMorphTargetBitGl(false);

/**
 * Blend-shape deformation that also accumulates NORMAL deltas (`geometry.hasMorphNormals`)
 * @internal
 */
export const morphTargetNormalBitGl: ShaderBit = createMorphTargetBitGl(true);
