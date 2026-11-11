import { mathConstantsBit } from '../../../core/shader/bits/mathConstantsBit';
import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Reads `pbrLightingBit`'s `nDotH` and `nDotV`. The 0.07 roughness and 0.0078125 `sin2h` floors stop `pow`
 * underflowing on mobile GPUs with 16-bit floats. The colour is divided by alpha to undo pixi's premultiplied upload
 * @internal
 */
export const sheenBit: ShaderBit = {
  name: 'sheen',

  requires: [mathConstantsBit],

  textures: ['sheen'],

  bindings: {
    material: {
      sheenParams: 'vec4<f32>',
    },
  },

  gpu: {
    header: /*wgsl*/ `
fn charlieD(charlieScale: f32, invAlphaHalf: f32, NdotH: f32) -> f32 {
  let cos2h = NdotH * NdotH;
  let sin2h = max(1.0 - cos2h, 0.0078125);
  return charlieScale * pow(sin2h, invAlphaHalf);
}

fn ashikhminV(NdotL: f32, NdotV: f32) -> f32 {
  return 1.0 / (4.0 * (NdotL + NdotV - NdotL * NdotV) + 1e-5);
}

fn sheenE(NdotV: f32, sheenRoughness: f32) -> f32 {
  let r = sheenRoughness;
  let a = mix(21.5473, 25.3245, r);
  let b = mix(3.82987, 3.32435, r);
  let c = mix(0.19823, 0.16801, r);
  let d = mix(-1.97760, -1.27393, r);
  let e = mix(-4.32054, -4.85967, r);
  return a / (1.0 + b * pow(NdotV, c)) + d * NdotV + e;
}
`,

    fragment: {
      lobePreLighting: /*wgsl*/ `
  let sheenTex = sampleSheen(input.vUV);
  let sheenTexStraight = sheenTex.rgb / max(sheenTex.a, 0.001);
  let sheenTexColor = pow(sheenTexStraight, vec3<f32>(2.2));
  let sheenColor = material.sheenParams.rgb * sheenTexColor;

  let sheenRoughnessIBL = clamp(material.sheenParams.a * sheenTex.a, 0.0, 1.0);
  let sheenRoughness = max(sheenRoughnessIBL, 0.07);
  let sheenAlpha = sheenRoughness * sheenRoughness;
  let sheenInvAlpha = 1.0 / sheenAlpha;
  let sheenInvAlphaHalf = sheenInvAlpha * 0.5;
  let sheenCharlieScale = (2.0 + sheenInvAlpha) * INV_PI * 0.5;
  let sheenMax = max(sheenColor.r, max(sheenColor.g, sheenColor.b));

  var sheenLight = vec3<f32>(0.0);
`,
      lobePerLight: /*wgsl*/ `
    {
      let shD = charlieD(sheenCharlieScale, sheenInvAlphaHalf, nDotH);
      let shV = ashikhminV(nDotL, nDotV);
      sheenLight += sheenColor * shD * shV * nDotL * light.color * attenuation * shadow;
    }
`,
      lobePostLighting: /*wgsl*/ `
  let shR = reflect(-viewDir, normal);
  let shPref = sampleEnvironment(shR, sheenRoughnessIBL);
  let shE = clamp(sheenE(nDotV, sheenRoughnessIBL), 0.0, 1.0);
  let sheenIBL = sheenColor * shPref * shE;
  let sheenAlbedoScale = 1.0 - sheenMax * shE;
  finalColor = finalColor * sheenAlbedoScale + sheenLight + sheenIBL;
`,
    },
  },

  gl: {
    fragment: {
      header: /*glsl*/ `
float charlieD(float charlieScale, float invAlphaHalf, float NdotH) {
  float cos2h = NdotH * NdotH;
  float sin2h = max(1.0 - cos2h, 0.0078125);
  return charlieScale * pow(sin2h, invAlphaHalf);
}

float ashikhminV(float NdotL, float NdotV) {
  return 1.0 / (4.0 * (NdotL + NdotV - NdotL * NdotV) + 1e-5);
}

float sheenE(float NdotV, float sheenRoughness) {
  float r = sheenRoughness;
  float a = mix(21.5473, 25.3245, r);
  float b = mix(3.82987, 3.32435, r);
  float c = mix(0.19823, 0.16801, r);
  float d = mix(-1.97760, -1.27393, r);
  float e = mix(-4.32054, -4.85967, r);
  return a / (1.0 + b * pow(NdotV, c)) + d * NdotV + e;
}
`,
      lobePreLighting: /*glsl*/ `
  vec4 sheenTex = sampleSheen(vUV);
  vec3 sheenTexStraight = sheenTex.rgb / max(sheenTex.a, 0.001);
  vec3 sheenTexColor = pow(sheenTexStraight, vec3(2.2));
  vec3 sheenColor = material.sheenParams.rgb * sheenTexColor;

  float sheenRoughnessIBL = clamp(material.sheenParams.a * sheenTex.a, 0.0, 1.0);
  float sheenRoughness = max(sheenRoughnessIBL, 0.07);
  float sheenAlpha = sheenRoughness * sheenRoughness;
  float sheenInvAlpha = 1.0 / sheenAlpha;
  float sheenInvAlphaHalf = sheenInvAlpha * 0.5;
  float sheenCharlieScale = (2.0 + sheenInvAlpha) * INV_PI * 0.5;
  float sheenMax = max(sheenColor.r, max(sheenColor.g, sheenColor.b));

  vec3 sheenLight = vec3(0.0);
`,
      lobePerLight: /*glsl*/ `
    {
      float shD = charlieD(sheenCharlieScale, sheenInvAlphaHalf, nDotH);
      float shV = ashikhminV(nDotL, nDotV);
      sheenLight += sheenColor * shD * shV * nDotL * light.color * attenuation * shadow;
    }
`,
      lobePostLighting: /*glsl*/ `
  vec3 shR = reflect(-viewDir, normal);
  vec3 shPref = sampleEnvironment(shR, sheenRoughnessIBL);
  float shE = clamp(sheenE(nDotV, sheenRoughnessIBL), 0.0, 1.0);
  vec3 sheenIBL = sheenColor * shPref * shE;
  float sheenAlbedoScale = 1.0 - sheenMax * shE;
  finalColor = finalColor * sheenAlbedoScale + sheenLight + sheenIBL;
`,
    },
  },
};
