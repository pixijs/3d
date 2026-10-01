import type { ShaderBit } from '../ShaderBit';

/**
 * Bends `normal` by the material's normal map, with the tangent frame from the mesh's `aTangent`
 *
 * The renderer picks it over `normalMappingBit` when the mesh has tangents, since they match the
 * frame the normal map was baked against. `aTangent.xyz` is the tangent and `aTangent.w` the
 * handedness, ±1.
 *
 * The vertex stage turns the tangent into world space with the model matrix, after skinning has
 * moved the shared `tangent` local, and builds the bitangent as `cross(worldNormal, worldTangent)`
 * times the handedness. It reads the `worldNormal` local rather than the `vNormal` varying, which
 * the template publishes only after this slot. The handedness comes straight from the attribute,
 * since a sign never goes through a matrix.
 *
 * Like `normalMappingBit`, it scales the map's `xy` by `normalScale` and takes `normalScale` and the
 * `normal` texture from the material bit, declaring no `material` fields of its own.
 * @internal
 */
export const tangentNormalMappingBit: ShaderBit = {
  name: 'tangentNormalMapping',

  attributes: {
    aTangent: 'float32x4',
  },

  interStage: {
    vTangent: 'vec3<f32>',
    vBitangent: 'vec3<f32>',
  },

  gpu: {
    vertex: {
      input: `
    tangent = input.aTangent.xyz;
  `,
      end: /*wgsl*/ `
  let worldTangent = normalize(modelMatrix3 * tangent);
  let worldBitangent = cross(worldNormal, worldTangent) * input.aTangent.w;
  output.vTangent = worldTangent;
  output.vBitangent = worldBitangent;
`,
    },
    fragment: {
      material: `
  let normalMapSample = sampleNormal(input.vUV).rgb;
  var tangentNormal = normalMapSample * 2.0 - 1.0;
  tangentNormal = vec3<f32>(tangentNormal.xy * material.normalScale, tangentNormal.z);
  let tbnMatrix = mat3x3<f32>(
    normalize(input.vTangent),
    normalize(input.vBitangent),
    normal
  );
  normal = normalize(tbnMatrix * tangentNormal);
`,
    },
  },

  gl: {
    vertex: {
      input: `
    tangent = aTangent.xyz;
  `,
      end: `
  vec3 worldTangent = normalize(modelMatrix3 * tangent);
  vec3 worldBitangent = cross(worldNormal, worldTangent) * aTangent.w;
  vTangent = worldTangent;
  vBitangent = worldBitangent;
`,
    },
    fragment: {
      material: `
  vec3 normalMapSample = sampleNormal(vUV).rgb;
  vec3 tangentNormal = normalMapSample * 2.0 - 1.0;
  tangentNormal.xy *= material.normalScale;
  mat3 tbnMatrix = mat3(
    normalize(vTangent),
    normalize(vBitangent),
    normal
  );
  normal = normalize(tbnMatrix * tangentNormal);
`,
    },
  },
};
