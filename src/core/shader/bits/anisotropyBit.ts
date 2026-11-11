import type { ShaderBit } from '../ShaderBit';
import { derivativeTangentFrameBit } from './derivativeTangentFrameBit';
import { mathConstantsBit } from './mathConstantsBit';

/**
 * Builds the frame on the geometric normal, since the mapped one makes the grain wobble per texel;
 * the lobes replace `pbrLightingBit`'s specular and read its locals
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
  let anisoTBN = calculateTBN(anisoGeoN, input.vPosition, input.vUV);
  let anisoT = normalize(anisoTBN * vec3<f32>(anisoDir, 0.0));
`;

  const glFrame = withVertexTangent
    ? /*glsl*/ `
  vec3 anisoTw = normalize(vAnisoTangent);
  vec3 anisoBw = normalize(vAnisoBitangent);
  vec3 anisoT = normalize(anisoDir.x * anisoTw + anisoDir.y * anisoBw);
`
    : /*glsl*/ `
  mat3 anisoTBN = calculateTBN(anisoGeoN, vPosition, vUV);
  vec3 anisoT = normalize(anisoTBN * vec3(anisoDir, 0.0));
`;

  const bit: ShaderBit = {
    name,

    requires: withVertexTangent ? [mathConstantsBit] : [mathConstantsBit, derivativeTangentFrameBit],

    textures: withTexture ? ['anisotropy'] : [],

    bindings: {
      material: {
        anisotropyParams: 'vec4<f32>',
      },
    },

    gpu: {
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

/** @internal */
export const anisotropyBit: ShaderBit = createAnisotropyBit(false, false);

/** @internal */
export const anisotropyTextureBit: ShaderBit = createAnisotropyBit(true, false);

/** @internal */
export const anisotropyTangentBit: ShaderBit = createAnisotropyBit(false, true);

/** @internal */
export const anisotropyTextureTangentBit: ShaderBit = createAnisotropyBit(true, true);

/**
 * Returns an anisotropy bit's vertex-tangent variant, which keeps its `material` fields and textures so
 * the material's layout holds, and any other bit unchanged
 * @internal
 */
export function anisotropyTangentVariant(bit: ShaderBit): ShaderBit {
  if (bit === anisotropyBit) return anisotropyTangentBit;
  if (bit === anisotropyTextureBit) return anisotropyTextureTangentBit;
  return bit;
}
