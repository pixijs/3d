import type { ShaderBit } from '../ShaderBit';

/**
 * Normal mapping using the mesh's vertex tangent attributes
 *
 * More accurate than derivative-based TBN, but requires tangent data in the
 * geometry; most glTF models include it. Without this bit the material uses
 * interpolated vertex normals (flat/smooth shading); with it, per-pixel
 * normals come from the normal map via the vertex TBN.
 *
 * Requires:
 *   - `aTangent` attribute (vec4 — xyz is tangent, w is handedness)
 *   - `normal: vec3` — must be initialized to the vertex normal before this runs
 *   - `input.vUV` / `vUV` — texture coordinates
 *   - `uNormalTexture` — normal map texture
 *
 * Outputs:
 *   - `normal: vec3` — updated with normal map detail
 * @internal
 */
export const tangentNormalMappingBit: ShaderBit = {
  name: 'tangentNormalMapping',

  attributes: {
    aTangent: 'float32x4', // xyz = tangent, w = handedness
  },

  interStage: {
    vTangent: 'vec3<f32>',
    vBitangent: 'vec3<f32>',
  },

  // No bindings: `normalScale` lives in pbrMaterialBit's material struct (this
  // bit is selected per-mesh and must not reshape the per-material struct), and
  // the normal map itself is sampled via the batch system's `sampleNormal`.
  gpu: {
    vertex: {
      input: `
    tangent = input.aTangent.xyz;
  `,
      end: /*wgsl*/ `
  // Transform tangent to world space and compute bitangent.
  // Reads the worldNormal local (not output.vNormal) so this bit doesn't
  // depend on the template having published varyings yet.
  // The local carries the direction, which skinning has already transformed.
  // Handedness is a per-vertex sign, so it is read straight off the attribute
  // and never goes through a matrix.
  let worldTangent = normalize(modelMatrix3 * tangent);
  let worldBitangent = cross(worldNormal, worldTangent) * input.aTangent.w;
  output.vTangent = worldTangent;
  output.vBitangent = worldBitangent;
`,
    },
    fragment: {
      material: `
  // Normal mapping with vertex tangents
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
  // Transform tangent to world space and compute bitangent.
  // Reads the worldNormal local (not vNormal) so this bit doesn't depend on
  // the template having published varyings yet.
  vec3 worldTangent = normalize(modelMatrix3 * tangent);
  vec3 worldBitangent = cross(worldNormal, worldTangent) * aTangent.w;
  vTangent = worldTangent;
  vBitangent = worldBitangent;
`,
    },
    fragment: {
      material: `
  // Normal mapping with vertex tangents
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
