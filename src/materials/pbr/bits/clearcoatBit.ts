import type { ShaderBit } from '../../../core/shader/ShaderBit';

/** The geometric normal, flipped on back faces; `createClearcoatBit` says why */
const CC_FACE_NORMAL_GPU = /*wgsl*/ `normalize(select(-input.vNormal, input.vNormal, input.frontFacing))`;
/** The geometric normal, flipped on back faces; `createClearcoatBit` says why */
const CC_FACE_NORMAL_GL = /*glsl*/ `normalize(gl_FrontFacing ? vNormal : -vNormal)`;

const CLEARCOAT_TBN_GPU = /*wgsl*/ `
fn calculateClearcoatTBN(surfaceNormal: vec3<f32>, position: vec3<f32>, texCoord: vec2<f32>) -> mat3x3<f32> {
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

const CLEARCOAT_TBN_GL = /*glsl*/ `
#ifndef PIXI3D_CLEARCOAT_TBN_DEFINED
#define PIXI3D_CLEARCOAT_TBN_DEFINED
mat3 calculateClearcoatTBN(highp vec3 surfaceNormal, highp vec3 position, highp vec2 texCoord) {
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
 * Build one of the two `KHR_materials_clearcoat` bits: a clear lacquer layer over the PBR surface,
 * with its own GGX highlight, roughness and optional normal map
 *
 * Material3D picks the variant at construction. Without a coat normal map (`clearcoat`, the common
 * case) the coat's normal is the geometric normal, so there is no tangent frame to build and no
 * texture to sample, which matters on mobile. With one (`clearcoat:normalMap`) the bit samples the
 * map and builds a tangent frame from screen-space derivatives. Both declare the same
 * `clearcoatParams`, so the material's struct is the same either way.
 *
 * The coat is a lobe in `pbrLightingBit`'s light loop (see {@link createLightingBit}), so the
 * material still runs one loop and samples each shadow once:
 *
 * - `lobePreLighting` reads the coat's factor, roughness and normal and hoists the
 *   light-independent GGX terms.
 * - `lobePerLight` adds this light's coat highlight: GGX with `pbrLightingBit`'s approximate
 *   visibility and Fresnel at `F0 = 0.04`, and no diffuse. Neither denominator needs a guard: the
 *   roughness floor keeps the GGX one at `ccA2` or more, and `ccNDotL > 0` with `ccVisV >= ccA`
 *   keeps the visibility one positive.
 * - `lobePostLighting` dims the base layer by the coat's Fresnel, then adds the coat's direct light
 *   and its environment reflection. Without that reflection a glossy coat would only darken the
 *   surface under image-based lighting.
 *
 * The coat's normal starts from the geometric normal `vNormal`, not the base `normal`, because the
 * coat's normal map is independent of the base one. `vNormal` isn't flipped on back faces the way
 * `doubleSidedNormalBit` flips `normal`, so both variants flip it by `frontFacing` themselves
 * (`CC_FACE_NORMAL_GPU`, `CC_FACE_NORMAL_GL`). Without the flip a double-sided coat reflects the
 * wrong half of the environment on its back faces, and `ccNDotV` collapses to grazing: a bright,
 * wrong reflection.
 *
 * Roughness comes in two tiers. The environment lookup and the BRDF table take the raw value, so a
 * mirror coat (roughness 0) samples mip 0 instead of looking frosted. The direct GGX floors it at
 * 0.04 and adds `pbrMaterialBit`'s `geometricRoughness`, clamped to 1, so a smooth coat on curved
 * or distant geometry doesn't sparkle.
 *
 * The coat's environment reflection is the split sum `prefiltered * (F0 * lut.x + lut.y)`, with
 * F90 fixed at 1 since the clearcoat spec has no F90 control. It isn't multiplied by occlusion:
 * occlusion shadows the base surface, and the coat sits on top of it.
 *
 * `F0 = 0.04` (IOR 1.5) is fixed by the spec, so it is the shader constant `CLEARCOAT_F0`, a
 * `const` in WGSL and a `#define` in GLSL. The tangent-frame helper is `calculateClearcoatTBN`
 * rather than `calculateTBN`, so it doesn't clash with `normalMappingBit`'s when a material has both
 * maps; its WGSL negates `dpdy()` for the reason `normalMappingBit` documents.
 *
 * `clearcoatParams` holds the factor in `.x`, the roughness in `.y` and the coat normal scale in
 * `.z`; `.w` is unused. The factor reads the red channel of its texture and the roughness the
 * green, as in glTF. Unset textures hold `Texture.WHITE`. The `clearcoatNormal` slot exists only on
 * the normal-map variant.
 *
 * Reads `normal`, `viewDir`, `finalColor`, `INV_PI` and `geometricRoughness`, which
 * `pbrMaterialBit` and `pbrLightingBit` declare.
 *
 * Spec: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_clearcoat
 * @param withNormalMap - Whether the coat samples its own normal map through a tangent frame
 */
function createClearcoatBit(withNormalMap: boolean): ShaderBit {
  const gpuNormal = withNormalMap
    ? /*wgsl*/ `
  let ccTangentNormal = sampleClearcoatNormal(input.vUV).rgb * 2.0 - 1.0;
  let ccScaledNormal = vec3<f32>(
    ccTangentNormal.xy * material.clearcoatParams.z,
    ccTangentNormal.z,
  );
  let ccTBN = calculateClearcoatTBN(${CC_FACE_NORMAL_GPU}, input.vPosition, input.vUV);
  let ccNormal = normalize(ccTBN * ccScaledNormal);
`
    : /*wgsl*/ `
  let ccNormal = ${CC_FACE_NORMAL_GPU};
`;

  const glNormal = withNormalMap
    ? /*glsl*/ `
  vec3 ccTangentNormal = sampleClearcoatNormal(vUV).rgb * 2.0 - 1.0;
  vec3 ccScaledNormal = vec3(ccTangentNormal.xy * material.clearcoatParams.z, ccTangentNormal.z);
  mat3 ccTBN = calculateClearcoatTBN(${CC_FACE_NORMAL_GL}, vPosition, vUV);
  vec3 ccNormal = normalize(ccTBN * ccScaledNormal);
`
    : /*glsl*/ `
  vec3 ccNormal = ${CC_FACE_NORMAL_GL};
`;

  return {
    name: withNormalMap ? 'clearcoat:normalMap' : 'clearcoat',

    textures: withNormalMap
      ? ['clearcoat', 'clearcoatRoughness', 'clearcoatNormal']
      : ['clearcoat', 'clearcoatRoughness'],

    bindings: {
      material: {
        clearcoatParams: 'vec4<f32>',
      },
    },

    gpu: {
      header: withNormalMap
        ? `const CLEARCOAT_F0: f32 = 0.04;\n${CLEARCOAT_TBN_GPU}`
        : `const CLEARCOAT_F0: f32 = 0.04;\n`,

      fragment: {
        lobePreLighting: /*wgsl*/ `
  let ccFactor = material.clearcoatParams.x * sampleClearcoat(input.vUV).r;
  let ccRoughnessRaw = material.clearcoatParams.y * sampleClearcoatRoughness(input.vUV).g;
  let ccRoughnessIBL = clamp(ccRoughnessRaw, 0.0, 1.0);
  let ccRoughness = min(max(ccRoughnessIBL, 0.04) + geometricRoughness, 1.0);
${gpuNormal}
  let ccA = ccRoughness * ccRoughness;
  let ccA2 = ccA * ccA;
  let ccA2InvPi = ccA2 * INV_PI;
  let ccOneMinusA = 1.0 - ccA;
  let ccNDotV = max(dot(ccNormal, viewDir), 0.0);
  let ccVisV = ccNDotV * ccOneMinusA + ccA;

  var clearcoatLight = vec3<f32>(0.0);
`,
        lobePerLight: /*wgsl*/ `
    {
      let ccHalfVector = normalize(viewDir + lightDir);
      let ccNDotL = max(dot(ccNormal, lightDir), 0.0);
      if (ccNDotL > 0.0) {
        let ccNDotH = max(dot(ccNormal, ccHalfVector), 0.0);
        let ccDDenom = (ccNDotH * ccNDotH * (ccA2 - 1.0) + 1.0);
        let ccD = ccA2InvPi / (ccDDenom * ccDDenom);
        let ccVis = 0.5 / (ccNDotL * ccVisV + ccNDotV * (ccNDotL * ccOneMinusA + ccA));
        let ccHDotV = max(dot(ccHalfVector, viewDir), 0.0);
        let ccFc5 = exp2((-5.55473 * ccHDotV - 6.98316) * ccHDotV);
        let ccF = CLEARCOAT_F0 + (1.0 - CLEARCOAT_F0) * ccFc5;
        clearcoatLight += ccD * ccF * ccVis * light.color * attenuation * ccNDotL * shadow;
      }
    }
`,
        lobePostLighting: /*wgsl*/ `
  let ccFcv5 = exp2((-5.55473 * ccNDotV - 6.98316) * ccNDotV);

  let ccR = reflect(-viewDir, ccNormal);
  let ccPrefiltered = sampleEnvironment(ccR, ccRoughnessIBL);
  let ccBrdf = textureSampleLevel(uBrdfLutTexture, uBrdfLutSampler, vec2<f32>(ccNDotV, ccRoughnessIBL), 0.0).rg;
  let clearcoatIBL = ccPrefiltered * (CLEARCOAT_F0 * ccBrdf.x + ccBrdf.y);

  let ccFv = CLEARCOAT_F0 + (1.0 - CLEARCOAT_F0) * ccFcv5;
  let ccAttenuation = 1.0 - ccFactor * ccFv;
  finalColor = finalColor * ccAttenuation + (clearcoatLight + clearcoatIBL) * ccFactor;
`,
      },
    },

    gl: {
      fragment: {
        header: withNormalMap
          ? /*glsl*/ `
#ifndef CLEARCOAT_F0
#define CLEARCOAT_F0 0.04
#endif
${CLEARCOAT_TBN_GL}`
          : /*glsl*/ `
#ifndef CLEARCOAT_F0
#define CLEARCOAT_F0 0.04
#endif
`,
        lobePreLighting: /*glsl*/ `
  float ccFactor = material.clearcoatParams.x * sampleClearcoat(vUV).r;
  float ccRoughnessRaw = material.clearcoatParams.y * sampleClearcoatRoughness(vUV).g;
  float ccRoughnessIBL = clamp(ccRoughnessRaw, 0.0, 1.0);
  float ccRoughness = min(max(ccRoughnessIBL, 0.04) + geometricRoughness, 1.0);
${glNormal}
  float ccA = ccRoughness * ccRoughness;
  float ccA2 = ccA * ccA;
  float ccA2InvPi = ccA2 * INV_PI;
  float ccOneMinusA = 1.0 - ccA;
  float ccNDotV = max(dot(ccNormal, viewDir), 0.0);
  float ccVisV = ccNDotV * ccOneMinusA + ccA;

  vec3 clearcoatLight = vec3(0.0);
`,
        lobePerLight: /*glsl*/ `
    {
      vec3 ccHalfVector = normalize(viewDir + lightDir);
      float ccNDotL = max(dot(ccNormal, lightDir), 0.0);
      if (ccNDotL > 0.0) {
        float ccNDotH = max(dot(ccNormal, ccHalfVector), 0.0);
        float ccDDenom = (ccNDotH * ccNDotH * (ccA2 - 1.0) + 1.0);
        float ccD = ccA2InvPi / (ccDDenom * ccDDenom);
        float ccVis = 0.5 / (ccNDotL * ccVisV + ccNDotV * (ccNDotL * ccOneMinusA + ccA));
        float ccHDotV = max(dot(ccHalfVector, viewDir), 0.0);
        float ccFc5 = exp2((-5.55473 * ccHDotV - 6.98316) * ccHDotV);
        float ccF = CLEARCOAT_F0 + (1.0 - CLEARCOAT_F0) * ccFc5;
        clearcoatLight += ccD * ccF * ccVis * light.color * attenuation * ccNDotL * shadow;
      }
    }
`,
        lobePostLighting: /*glsl*/ `
  float ccFcv5 = exp2((-5.55473 * ccNDotV - 6.98316) * ccNDotV);

  vec3 ccR = reflect(-viewDir, ccNormal);
  vec3 ccPrefiltered = sampleEnvironment(ccR, ccRoughnessIBL);
  vec2 ccBrdf = texture(uBrdfLutTexture, vec2(ccNDotV, ccRoughnessIBL)).rg;
  vec3 clearcoatIBL = ccPrefiltered * (CLEARCOAT_F0 * ccBrdf.x + ccBrdf.y);

  float ccFv = CLEARCOAT_F0 + (1.0 - CLEARCOAT_F0) * ccFcv5;
  float ccAttenuation = 1.0 - ccFactor * ccFv;
  finalColor = finalColor * ccAttenuation + (clearcoatLight + clearcoatIBL) * ccFactor;
`,
      },
    },
  };
}

/**
 * Clearcoat whose normal is the geometric normal; see `createClearcoatBit`
 * @internal
 */
export const clearcoatBit: ShaderBit = createClearcoatBit(false);

/**
 * Clearcoat that samples its own normal map; see `createClearcoatBit`
 * @internal
 */
export const clearcoatNormalMapBit: ShaderBit = createClearcoatBit(true);
