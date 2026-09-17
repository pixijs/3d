import { GeometryDataStruct } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Blend-shape deformation for the WebGPU backend, applied before skinning
 *
 * Sums `Σ delta_i × weight_i` into the vertex position — and, in the
 * `hasNormals` variant, the vertex normal — before the skinning bit runs, so a
 * skin matrix transforms the morphed values. Composed only when
 * `geometry.morphTargetCount > 0`; the normal variant is chosen when
 * `geometry.hasMorphNormals`. The `hasNormals` flag bakes the arena stride
 * (4 floats/target positions-only, 8 with normals) and the extra normal
 * fetch + renormalize.
 *
 * Deltas and weights live in one `uMorphStorage: array<f32>` — a static delta
 * arena up front, fixed per-mesh weight slots behind it — see
 * `MorphStoreBuffer`. Four floats per delta (`xyz` + unused `w`); the
 * normal variant packs a second `xyzw` behind each position. The per-geometry
 * facts (delta base, target count, atlas base vertex) come from the
 * geometry-store row via `renderable.geometryDataIndex`; only the per-instance
 * weight offset rides the mesh row, and `0` there means "no morph slot" (real
 * offsets start past the arena), which gates the whole block — a mesh swapped
 * onto a morphed geometry without morph state renders base pose.
 *
 * `vid - baseVertex` recovers the geometry-local vertex id the delta arena is
 * indexed by, so morphed geometry atlases like any other (`baseVertex` is 0
 * for non-atlased geometry, whose vertex ids are already local).
 *
 * Requires `@builtin(vertex_index) vid` in the entry point — provided by the
 * material and shadow vertex templates.
 * @param hasNormals - Whether the morph deltas carry normals, packing a normal texel behind each position
 */
function createMorphTargetBitGpu(hasNormals: boolean): ShaderBit {
  const stride = hasNormals ? 8 : 4; // floats per target per vertex (position texel, plus normal texel with normals)

  return {
    name: hasNormals ? 'morphTargetNormal' : 'morphTarget',
    structs: {
      GeometryData: GeometryDataStruct,
    },
    bindings: {
      global: {
        uMorphStorage: 'storage<f32>',
        uGeometryStorage: 'storage<GeometryData>',
      },
    },
    gpu: {
      vertex: {
        input: `
        if (renderable.morphWeightIndex != 0u) {
          let geometryData = uGeometryStorage[renderable.geometryDataIndex];
          let vidLocal = vid - geometryData.baseVertex;
          let morphDeltaBase = geometryData.morphDeltaBase + vidLocal * geometryData.morphTargetCount * ${stride}u;
          var morphedPosition = position.xyz;${hasNormals ? '\n          var morphedNormal = normal;' : ''}
          for (var morphIndex = 0u; morphIndex < geometryData.morphTargetCount; morphIndex = morphIndex + 1u) {
            // Parked dials are exactly 0 — skip the delta fetch. Weights are
            // per-instance, so the branch is wavefront-coherent: a scalar
            // compare at worst, most of the loop's bandwidth at best.
            let weight = uMorphStorage[renderable.morphWeightIndex + morphIndex];
            if (weight != 0.0) {
              let deltaOffset = morphDeltaBase + morphIndex * ${stride}u;
              morphedPosition += vec3<f32>(
                uMorphStorage[deltaOffset],
                uMorphStorage[deltaOffset + 1u],
                uMorphStorage[deltaOffset + 2u],
              ) * weight;${
                hasNormals
                  ? `
              morphedNormal += vec3<f32>(
                uMorphStorage[deltaOffset + 4u],
                uMorphStorage[deltaOffset + 5u],
                uMorphStorage[deltaOffset + 6u],
              ) * weight;`
                  : ''
              }
            }
          }
          position = vec4<f32>(morphedPosition, position.w);${
            hasNormals ? '\n          normal = normalize(morphedNormal);' : ''
          }
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
export const morphTargetBitGpu: ShaderBit = createMorphTargetBitGpu(false);

/**
 * Blend-shape deformation that also accumulates NORMAL deltas (`geometry.hasMorphNormals`)
 * @internal
 */
export const morphTargetNormalBitGpu: ShaderBit = createMorphTargetBitGpu(true);
