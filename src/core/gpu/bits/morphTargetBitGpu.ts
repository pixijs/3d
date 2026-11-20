import { GeometryDataStruct } from '../../shader/bits/shaderStructs';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * WebGPU twin of `morphTargetBitGl`, reading `uMorphStorage` as `MorphStoreBuffer` lays it out. The
 * template must declare `@builtin(vertex_index) vid`. The `weight != 0` branch is uniform per instance, so it stays.
 * The `previous` form morphs `previousPosition` alone, with the stride its geometry's normals set, and the material
 * system adds it after its twin, whose bindings it reads.
 */
function createMorphTargetBitGpu(hasNormals: boolean, previous = false): ShaderBit {
  const stride = hasNormals ? 8 : 4;
  const target = previous ? 'previousPosition' : 'position';
  const weightIndex = previous ? 'renderable.previousMorphWeightIndex' : 'renderable.morphWeightIndex';
  const deformNormals = hasNormals && !previous;

  const input = `
        if (${weightIndex} != 0u) {
          let geometryData = uGeometryStorage[renderable.geometryDataIndex];
          let vidLocal = vid - geometryData.baseVertex;
          let morphDeltaBase = geometryData.morphDeltaBase + vidLocal * geometryData.morphTargetCount * ${stride}u;
          var morphedPosition = ${target}.xyz;${deformNormals ? '\n          var morphedNormal = normal;' : ''}
          for (var morphIndex = 0u; morphIndex < geometryData.morphTargetCount; morphIndex = morphIndex + 1u) {
            let weight = uMorphStorage[${weightIndex} + morphIndex];
            if (weight != 0.0) {
              let deltaOffset = morphDeltaBase + morphIndex * ${stride}u;
              morphedPosition += vec3<f32>(
                uMorphStorage[deltaOffset],
                uMorphStorage[deltaOffset + 1u],
                uMorphStorage[deltaOffset + 2u],
              ) * weight;${
                deformNormals
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
          ${target} = vec4<f32>(morphedPosition, ${target}.w);${
            deformNormals ? '\n          normal = normalize(morphedNormal);' : ''
          }
        }
      `;

  if (previous) {
    return {
      name: hasNormals ? 'previousMorphTargetNormal' : 'previousMorphTarget',
      gpu: { vertex: { input } },
    };
  }

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
    gpu: { vertex: { input } },
  };
}

/** @internal */
export const morphTargetBitGpu: ShaderBit = createMorphTargetBitGpu(false);

/** @internal */
export const morphTargetNormalBitGpu: ShaderBit = createMorphTargetBitGpu(true);

/** @internal */
export const previousMorphTargetBitGpu: ShaderBit = createMorphTargetBitGpu(false, true);

/** @internal */
export const previousMorphTargetNormalBitGpu: ShaderBit = createMorphTargetBitGpu(true, true);
