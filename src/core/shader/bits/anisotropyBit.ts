import type { ShaderBit } from '../ShaderBit';

/**
 * WGSL `calculateAnisotropyTBN`: the derivative tangent frame of `normalMappingBit`, for the
 * variants without vertex tangents
 */
const ANISOTROPY_TBN_GPU = /*wgsl*/ `
fn calculateAnisotropyTBN(surfaceNormal: vec3<f32>, position: vec3<f32>, texCoord: vec2<f32>) -> mat3x3<f32> {
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
`;

/** The GLSL `calculateAnisotropyTBN`, guarded so that two anisotropy bits in one shader declare it once */
const ANISOTROPY_TBN_GL = /*glsl*/ `
#ifndef PIXI3D_ANISOTROPY_TBN_DEFINED
#define PIXI3D_ANISOTROPY_TBN_DEFINED
mat3 calculateAnisotropyTBN(highp vec3 surfaceNormal, highp vec3 position, highp vec2 texCoord) {
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
#endif
`;

/**
 * Builds a `KHR_materials_anisotropy` bit: a specular highlight stretched along a direction on the
 * surface, the look of brushed metal, vinyl records and woven carbon fibre
 *
 * There are four variants:
 * - Without a texture the direction is `(1, 0)` in tangent space and the strength comes from the
 *   factor alone. With one, the texture's red and green hold the direction, encoded from [-1, 1],
 *   and its blue scales the strength. `Material3D` picks this at construction.
 * - Without `aTangent` the tangent frame comes from screen-space UV derivatives, so it works on
 *   meshes that ship no tangents. With it, the frame comes from the mesh's tangents and is smooth.
 *   The renderer picks this per mesh with `anisotropyTangentVariant`. The swap keeps the
 *   `anisotropyParams` field and the textures, so the material's layout doesn't change.
 *
 * `anisotropyParams.x` is the strength and `.y` the rotation in radians, counter-clockwise from the
 * tangent; `.zw` are unused. The frame is built against the geometric normal, flipped on back
 * faces, rather than the normal-mapped one, against which the direction would wobble from texel to
 * texel. Shading still uses the mapped `normal`. The bitangent is the geometric normal crossed with
 * the tangent, as in the glTF sample renderer.
 *
 * The clearcoat and sheen lobes add a layer, but this one replaces the base layer's specular. In
 * `pbrLightingBit`'s loop it adds `anisotropicSpecular - specular`, so one loop and one shadow
 * sample still serve both, and diffuse is untouched:
 * - `lobePreLighting` works out the two roughnesses, α_b = α and α_t = mix(α, 1, strength²), from
 *   `pbrLightingBit`'s α = roughness², and hoists T·V and B·V.
 * - `lobePerLight` evaluates the anisotropic GGX distribution and height-correlated visibility the
 *   spec gives, after Burley 2012 and Heitz 2014.
 *
 * For the environment it bends `specularNormal`, which `pbrMaterialBit` sets to `normal` and
 * `iblBit` reflects off, toward the grain, as the glTF sample renderer does:
 * `normalize(mix(bent, normal, (1 - strength * (1 - roughness))⁴))`, where `bent` is
 * `cross(cross(B, V), B)` normalized. Where `B` lines up with the view that cross product vanishes,
 * and `normal` stands in rather than normalizing zero. Diffuse and the BRDF's N·V still use
 * `normal`. The bend runs in the `material` slot, before `iblBit` reads `specularNormal` in the
 * `lighting` slot.
 *
 * The tangent variants turn the shared `tangent` local into world space after the skinning bits
 * have moved it, so the grain follows the skeleton, and take the handedness from the raw attribute.
 * They write their own `vAnisoTangent` and `vAnisoBitangent` varyings, apart from
 * `tangentNormalMappingBit`'s, and the `aTangent` they share is declared once.
 *
 * WGSL's `calculateAnisotropyTBN` negates `dpdy` for the reason `normalMappingBit` gives. It is
 * named apart from `calculateTBN` so a normal-mapped material doesn't declare that twice.
 *
 * Spec: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_anisotropy
 * @param withTexture - Samples the per-texel direction/strength map instead of the cheaper factor-only default
 * @param withVertexTangent - Builds the tangent frame from the mesh's `TANGENT` attribute (smooth, matches the
 *   glTF reference) instead of the screen-space UV-derivative fallback for meshes that ship no tangents
 */
function createAnisotropyBit(withTexture: boolean, withVertexTangent: boolean): ShaderBit {
  const name = `anisotropy${withTexture ? ':texture' : ''}${withVertexTangent ? ':tangent' : ''}`;

  const gpuSource = withTexture
    ? /*wgsl*/ `
  let anisoSample = sampleAnisotropy(input.vUV);
  let anisoDirRaw = anisoSample.rg * 2.0 - 1.0;
  let anisoTexStrength = anisoSample.b;
`
    : /*wgsl*/ `
  let anisoDirRaw = vec2<f32>(1.0, 0.0);
  let anisoTexStrength = 1.0;
`;

  const glSource = withTexture
    ? /*glsl*/ `
  vec4 anisoSample = sampleAnisotropy(vUV);
  vec2 anisoDirRaw = anisoSample.rg * 2.0 - 1.0;
  float anisoTexStrength = anisoSample.b;
`
    : /*glsl*/ `
  vec2 anisoDirRaw = vec2(1.0, 0.0);
  float anisoTexStrength = 1.0;
`;

  const gpuFrame = withVertexTangent
    ? /*wgsl*/ `
  let anisoTw = normalize(input.vAnisoTangent);
  let anisoBw = normalize(input.vAnisoBitangent);
  let anisoT = normalize(anisoDir.x * anisoTw + anisoDir.y * anisoBw);
`
    : /*wgsl*/ `
  let anisoTBN = calculateAnisotropyTBN(anisoGeoN, input.vPosition, input.vUV);
  let anisoT = normalize(anisoTBN * vec3<f32>(anisoDir, 0.0));
`;

  const glFrame = withVertexTangent
    ? /*glsl*/ `
  vec3 anisoTw = normalize(vAnisoTangent);
  vec3 anisoBw = normalize(vAnisoBitangent);
  vec3 anisoT = normalize(anisoDir.x * anisoTw + anisoDir.y * anisoBw);
`
    : /*glsl*/ `
  mat3 anisoTBN = calculateAnisotropyTBN(anisoGeoN, vPosition, vUV);
  vec3 anisoT = normalize(anisoTBN * vec3(anisoDir, 0.0));
`;

  const bit: ShaderBit = {
    name,

    textures: withTexture ? ['anisotropy'] : [],

    bindings: {
      material: {
        anisotropyParams: 'vec4<f32>',
      },
    },

    gpu: {
      header: withVertexTangent ? undefined : ANISOTROPY_TBN_GPU,
      fragment: {
        material: /*wgsl*/ `
${gpuSource}
  let anisoRot = material.anisotropyParams.y;
  let anisoC = cos(anisoRot);
  let anisoS = sin(anisoRot);
  let anisoDir = vec2<f32>(
    anisoDirRaw.x * anisoC - anisoDirRaw.y * anisoS,
    anisoDirRaw.x * anisoS + anisoDirRaw.y * anisoC,
  );
  let anisoStrength = clamp(material.anisotropyParams.x * anisoTexStrength, 0.0, 1.0);

  let anisoGeoN = normalize(select(-input.vNormal, input.vNormal, input.frontFacing));
${gpuFrame}
  let anisoB = normalize(cross(anisoGeoN, anisoT));

  let anisoBentCross = cross(cross(anisoB, viewDir), anisoB);
  let anisoBentLenSq = dot(anisoBentCross, anisoBentCross);
  var anisoBentN = normal;
  if (anisoBentLenSq > 1e-8) {
    anisoBentN = anisoBentCross * inverseSqrt(anisoBentLenSq);
  }
  let anisoBend = 1.0 - anisoStrength * (1.0 - roughness);
  let anisoBend4 = anisoBend * anisoBend * anisoBend * anisoBend;
  specularNormal = normalize(mix(anisoBentN, normal, anisoBend4));
`,
        lobePreLighting: /*wgsl*/ `
  let anisoAlphaB = a;
  let anisoAlphaT = mix(a, 1.0, anisoStrength * anisoStrength);
  let anisoTdotV = dot(anisoT, viewDir);
  let anisoBdotV = dot(anisoB, viewDir);
`,
        lobePerLight: /*wgsl*/ `
    {
      let anisoTdotL = dot(anisoT, lightDir);
      let anisoBdotL = dot(anisoB, lightDir);
      let anisoTdotH = dot(anisoT, halfVector);
      let anisoBdotH = dot(anisoB, halfVector);

      let anisoA2 = anisoAlphaT * anisoAlphaB;
      let anisoFv = vec3<f32>(anisoAlphaB * anisoTdotH, anisoAlphaT * anisoBdotH, anisoA2 * nDotH);
      let anisoW2 = anisoA2 / dot(anisoFv, anisoFv);
      let anisoD = anisoA2 * anisoW2 * anisoW2 * INV_PI;

      let anisoGGXV = nDotL * length(vec3<f32>(anisoAlphaT * anisoTdotV, anisoAlphaB * anisoBdotV, nDotV));
      let anisoGGXL = nDotV * length(vec3<f32>(anisoAlphaT * anisoTdotL, anisoAlphaB * anisoBdotL, nDotL));
      let anisoVis = 0.5 / max(anisoGGXV + anisoGGXL, 1e-5);

      let anisoSpec = anisoD * fresnel * anisoVis;
      directLight += (anisoSpec - specular) * radiance * nDotL * shadow;
    }
`,
      },
    },

    gl: {
      fragment: {
        header: withVertexTangent ? undefined : ANISOTROPY_TBN_GL,
        material: /*glsl*/ `
${glSource}
  float anisoRot = material.anisotropyParams.y;
  float anisoC = cos(anisoRot);
  float anisoS = sin(anisoRot);
  vec2 anisoDir = vec2(
    anisoDirRaw.x * anisoC - anisoDirRaw.y * anisoS,
    anisoDirRaw.x * anisoS + anisoDirRaw.y * anisoC
  );
  float anisoStrength = clamp(material.anisotropyParams.x * anisoTexStrength, 0.0, 1.0);

  vec3 anisoGeoN = normalize(gl_FrontFacing ? vNormal : -vNormal);
${glFrame}
  vec3 anisoB = normalize(cross(anisoGeoN, anisoT));

  vec3 anisoBentCross = cross(cross(anisoB, viewDir), anisoB);
  float anisoBentLenSq = dot(anisoBentCross, anisoBentCross);
  vec3 anisoBentN = anisoBentLenSq > 1e-8 ? anisoBentCross * inversesqrt(anisoBentLenSq) : normal;
  float anisoBend = 1.0 - anisoStrength * (1.0 - roughness);
  float anisoBend4 = anisoBend * anisoBend * anisoBend * anisoBend;
  specularNormal = normalize(mix(anisoBentN, normal, anisoBend4));
`,
        lobePreLighting: /*glsl*/ `
  float anisoAlphaB = a;
  float anisoAlphaT = mix(a, 1.0, anisoStrength * anisoStrength);
  float anisoTdotV = dot(anisoT, viewDir);
  float anisoBdotV = dot(anisoB, viewDir);
`,
        lobePerLight: /*glsl*/ `
    {
      float anisoTdotL = dot(anisoT, lightDir);
      float anisoBdotL = dot(anisoB, lightDir);
      float anisoTdotH = dot(anisoT, halfVector);
      float anisoBdotH = dot(anisoB, halfVector);

      float anisoA2 = anisoAlphaT * anisoAlphaB;
      vec3 anisoFv = vec3(anisoAlphaB * anisoTdotH, anisoAlphaT * anisoBdotH, anisoA2 * nDotH);
      float anisoW2 = anisoA2 / dot(anisoFv, anisoFv);
      float anisoD = anisoA2 * anisoW2 * anisoW2 * INV_PI;

      float anisoGGXV = nDotL * length(vec3(anisoAlphaT * anisoTdotV, anisoAlphaB * anisoBdotV, nDotV));
      float anisoGGXL = nDotV * length(vec3(anisoAlphaT * anisoTdotL, anisoAlphaB * anisoBdotL, nDotL));
      float anisoVis = 0.5 / max(anisoGGXV + anisoGGXL, 1e-5);

      vec3 anisoSpec = anisoD * fresnel * anisoVis;
      directLight += (anisoSpec - specular) * radiance * nDotL * shadow;
    }
`,
      },
    },
  };

  if (withVertexTangent) {
    bit.attributes = { aTangent: 'float32x4' };
    bit.interStage = { vAnisoTangent: 'vec3<f32>', vAnisoBitangent: 'vec3<f32>' };
    bit.gpu!.vertex = {
      input: /*wgsl*/ `  tangent = input.aTangent.xyz;`,
      end: /*wgsl*/ `
  let anisoWorldT = normalize(modelMatrix3 * tangent);
  output.vAnisoTangent = anisoWorldT;
  output.vAnisoBitangent = cross(worldNormal, anisoWorldT) * input.aTangent.w;
`,
    };
    bit.gl!.vertex = {
      input: /*glsl*/ `  tangent = aTangent.xyz;`,
      end: /*glsl*/ `
  vec3 anisoWorldT = normalize(modelMatrix3 * tangent);
  vAnisoTangent = anisoWorldT;
  vAnisoBitangent = cross(worldNormal, anisoWorldT) * aTangent.w;
`,
    };
  }

  return bit;
}

/**
 * Anisotropy from the factor alone, with the derivative tangent frame; see `createAnisotropyBit`
 * @internal
 */
export const anisotropyBit: ShaderBit = createAnisotropyBit(false, false);

/**
 * Anisotropy with a direction and strength texture, with the derivative tangent frame
 * @internal
 */
export const anisotropyTextureBit: ShaderBit = createAnisotropyBit(true, false);

/**
 * Anisotropy from the factor alone, with the mesh's tangents for its frame
 * @internal
 */
export const anisotropyTangentBit: ShaderBit = createAnisotropyBit(false, true);

/**
 * Anisotropy with a direction and strength texture, with the mesh's tangents for its frame
 * @internal
 */
export const anisotropyTextureTangentBit: ShaderBit = createAnisotropyBit(true, true);

/**
 * Returns the vertex-tangent variant of an anisotropy bit, and any other bit unchanged
 *
 * Both material systems call it on every descriptor bit of a mesh that has `aTangent`, as they
 * pick `tangentNormalMappingBit` over `normalMappingBit`.
 * @param bit - The descriptor bit to map
 * @returns The vertex-tangent variant for anisotropy bits; `bit` unchanged otherwise
 * @internal
 */
export function anisotropyTangentVariant(bit: ShaderBit): ShaderBit {
  if (bit === anisotropyBit) return anisotropyTangentBit;
  if (bit === anisotropyTextureBit) return anisotropyTextureTangentBit;
  return bit;
}
