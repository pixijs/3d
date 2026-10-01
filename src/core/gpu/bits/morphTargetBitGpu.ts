import { GeometryDataStruct } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Blend-shape deformation for WebGPU: adds each morph target's delta, scaled by its weight, to the
 * vertex position, and in the `hasNormals` variant to the normal too, which it then renormalizes
 *
 * Runs in `vertexInput` after the position bit and before skinning, so the skin transforms the
 * morphed values. `MaterialSystemGpu` adds it to a mesh that has a `morph`, picking the normal
 * variant when `geometry.hasMorphNormals`. The loop runs to the geometry's target count, so one
 * variant serves every count.
 *
 * Deltas and weights share `uMorphStorage`; `MorphStoreBuffer` lays it out. A delta is four floats
 * (`xyz` and an unused `w`), and the normal variant stores the normal delta right after the
 * position delta, so `stride` is 4 or 8 floats per target per vertex. The geometry's delta base,
 * target count and atlas `baseVertex` come from its row in `uGeometryStorage`. Only the weight
 * offset is per mesh, in `renderable.morphWeightIndex`. An offset of 0 means the mesh has no weight
 * slot, since real offsets start past the delta arena, and the vertex keeps its base pose.
 *
 * `vid - baseVertex` turns the atlas-wide vertex index into the geometry-local one the deltas are
 * indexed by; geometry outside an atlas has a `baseVertex` of 0. The templates must pass
 * `@builtin(vertex_index) vid`, as the material and shadow templates do.
 *
 * A weight of exactly 0 skips that target's reads. Weights are per instance, so every vertex of
 * an instance takes the same branch, and a target left at 0 costs one compare.
 * `morphTargetBitGl` is the WebGL twin.
 * @param hasNormals - Whether the morph deltas carry normals, packing a normal delta behind each position delta
 */
function createMorphTargetBitGpu(hasNormals: boolean): ShaderBit {
  const stride = hasNormals ? 8 : 4;

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
 * Blend-shape deformation that also accumulates normal deltas (`geometry.hasMorphNormals`)
 * @internal
 */
export const morphTargetNormalBitGpu: ShaderBit = createMorphTargetBitGpu(true);
