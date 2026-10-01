import type { ShaderBit } from '../ShaderBit';

/**
 * Bends `normal` by the material's normal map, with a tangent frame built from screen-space
 * derivatives
 *
 * The renderer adds it when the material's `normal` slot holds a real map and the mesh has UVs but
 * no `aTangent`; with tangents it adds `tangentNormalMappingBit` instead. `calculateTBN` is
 * Schüler's cotangent frame ("Followup: Normal Mapping Without Precomputed Tangents", 2013): it
 * works out the tangent and bitangent from the derivatives of the world position and the UV, so the
 * mesh needs no tangent attribute.
 *
 * The map's normal is scaled as glTF's `normalTexture.scale` asks: `xy` times the material's
 * `normalScale`, then normalized. The bit declares no `material` fields of its own. It is chosen
 * per mesh, while a material's struct is fixed at construction, so `normalScale` and the `normal`
 * texture come from the material bit (`pbrMaterialBit` or `phongMaterialBit`).
 *
 * WGSL's `calculateTBN` negates `dpdy`. Window y points down in WebGPU and up in WebGL, so
 * `dpdy(p)` is `-dFdy(p)` for the same fragment. Left alone, that flips both the tangent and the
 * bitangent, which turns the bumps inside out: ridges shade like dents. Negating `dpdy` makes the
 * WGSL frame match the GLSL one. `normalMappingBit.test.ts` holds the two in step.
 * @internal
 */
export const normalMappingBit: ShaderBit = {
  name: 'normalMapping',

  gpu: {
    header: `
fn calculateTBN(surfaceNormal: vec3<f32>, position: vec3<f32>, texCoord: vec2<f32>) -> mat3x3<f32> {
  let dp1 = dpdx(position);
  let dp2 = -dpdy(position);
  let duv1 = dpdx(texCoord);
  let duv2 = -dpdy(texCoord);

  let dp2perp = cross(dp2, surfaceNormal);
  let dp1perp = cross(surfaceNormal, dp1);
  let tangent = dp2perp * duv1.x + dp1perp * duv2.x;
  let bitangent = dp2perp * duv1.y + dp1perp * duv2.y;

  let invmax = inverseSqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
  return mat3x3<f32>(tangent * invmax, bitangent * invmax, surfaceNormal);
}
`,
    fragment: {
      material: `
  let normalMapSample = sampleNormal(input.vUV).rgb;
  var tangentNormal = normalMapSample * 2.0 - 1.0;
  tangentNormal = vec3<f32>(tangentNormal.xy * material.normalScale, tangentNormal.z);
  let tbnMatrix = calculateTBN(normal, input.vPosition, input.vUV);
  normal = normalize(tbnMatrix * tangentNormal);
`,
    },
  },

  gl: {
    fragment: {
      header: `
mat3 calculateTBN(highp vec3 surfaceNormal, highp vec3 position, highp vec2 texCoord) {
  highp vec3 dp1 = dFdx(position);
  highp vec3 dp2 = dFdy(position);
  highp vec2 duv1 = dFdx(texCoord);
  highp vec2 duv2 = dFdy(texCoord);

  highp vec3 dp2perp = cross(dp2, surfaceNormal);
  highp vec3 dp1perp = cross(surfaceNormal, dp1);
  highp vec3 tangent = dp2perp * duv1.x + dp1perp * duv2.x;
  highp vec3 bitangent = dp2perp * duv1.y + dp1perp * duv2.y;

  highp float invmax = inversesqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
  return mat3(tangent * invmax, bitangent * invmax, surfaceNormal);
}
`,
      material: `
  {
  vec3 normalMapSample = sampleNormal(vUV).rgb;
  vec3 tangentNormal = normalMapSample * 2.0 - 1.0;
  tangentNormal.xy *= material.normalScale;
  mat3 tbnMatrix = calculateTBN(normal, vPosition, vUV);
  normal = normalize(tbnMatrix * tangentNormal);
  }
`,
    },
  },
};
