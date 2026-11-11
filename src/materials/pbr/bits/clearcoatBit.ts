import { derivativeTangentFrameBit } from '../../../core/shader/bits/derivativeTangentFrameBit';
import { mathConstantsBit } from '../../../core/shader/bits/mathConstantsBit';
import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * The geometric normal flipped on back faces, in both constants: the coat skips the base normal map, and
 * `doubleSidedNormalBit` flips only `normal`
 */
const CC_FACE_NORMAL_GPU = /*wgsl*/ `normalize(select(-input.vNormal, input.vNormal, input.frontFacing))`;
const CC_FACE_NORMAL_GL = /*glsl*/ `normalize(gl_FrontFacing ? vNormal : -vNormal)`;

/**
 * The direct GGX floors roughness and runs only where `ccNDotL > 0`, which keeps both divides off zero;
 * the environment reads the raw roughness, so a mirror coat stays sharp
 */
function createClearcoatBit(withNormalMap: boolean): ShaderBit {
  const gpuNormal = withNormalMap
    ? /*wgsl*/ `
  let ccTangentNormal = sampleClearcoatNormal(input.vUV).rgb * 2.0 - 1.0;
  let ccScaledNormal = vec3<f32>(
    ccTangentNormal.xy * material.clearcoatParams.z,
    ccTangentNormal.z,
  );
  let ccTBN = calculateTBN(${CC_FACE_NORMAL_GPU}, input.vPosition, input.vUV);
  let ccNormal = normalize(ccTBN * ccScaledNormal);
`
    : /*wgsl*/ `
  let ccNormal = ${CC_FACE_NORMAL_GPU};
`;

  const glNormal = withNormalMap
    ? /*glsl*/ `
  vec3 ccTangentNormal = sampleClearcoatNormal(vUV).rgb * 2.0 - 1.0;
  vec3 ccScaledNormal = vec3(ccTangentNormal.xy * material.clearcoatParams.z, ccTangentNormal.z);
  mat3 ccTBN = calculateTBN(${CC_FACE_NORMAL_GL}, vPosition, vUV);
  vec3 ccNormal = normalize(ccTBN * ccScaledNormal);
`
    : /*glsl*/ `
  vec3 ccNormal = ${CC_FACE_NORMAL_GL};
`;

  return {
    name: withNormalMap ? 'clearcoat:normalMap' : 'clearcoat',

    requires: withNormalMap ? [mathConstantsBit, derivativeTangentFrameBit] : [mathConstantsBit],

    textures: withNormalMap
      ? ['clearcoat', 'clearcoatRoughness', 'clearcoatNormal']
      : ['clearcoat', 'clearcoatRoughness'],

    bindings: {
      material: {
        clearcoatParams: 'vec4<f32>',
      },
    },

    gpu: {
      header: `const CLEARCOAT_F0: f32 = 0.04;\n`,

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
        header: /*glsl*/ `
#define CLEARCOAT_F0 0.04
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

/** @internal */
export const clearcoatBit: ShaderBit = createClearcoatBit(false);

/** @internal */
export const clearcoatNormalMapBit: ShaderBit = createClearcoatBit(true);
