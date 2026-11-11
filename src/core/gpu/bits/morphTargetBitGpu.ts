import { GeometryDataStruct } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * WebGPU twin of `morphTargetBitGl`, reading `uMorphStorage` as `MorphStoreBuffer` lays it out. The
 * template must declare `@builtin(vertex_index) vid`. The `weight != 0` branch is uniform per instance, so it stays.
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

/** @internal */
export const morphTargetBitGpu: ShaderBit = createMorphTargetBitGpu(false);

/** @internal */
export const morphTargetNormalBitGpu: ShaderBit = createMorphTargetBitGpu(true);
