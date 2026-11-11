import type { ShaderBit } from '../ShaderBit';

/**
 * Reads `worldNormal`, since the template writes `vNormal` after this slot. Declares no `material`
 * fields or textures, for the reason `normalMappingBit` gives.
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
