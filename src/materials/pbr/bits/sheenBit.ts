import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * `KHR_materials_sheen`: the soft glow at grazing angles on velvet, satin and other cloth
 *
 * Uses the Charlie distribution with Ashikhmin visibility, as the glTF spec's appendix recommends,
 * and no Fresnel. It is a lobe in `pbrLightingBit`'s light loop (see {@link createLightingBit}), so
 * a sheen material still runs one loop and samples each shadow once:
 *
 * - `lobePreLighting` reads the sheen colour and roughness and hoists the light-independent parts
 *   of the Charlie distribution, `(2 + 1/α) / 2π` and `1 / 2α`, so each light costs one `pow` and
 *   a multiply.
 * - `lobePerLight` adds this light's sheen. It reuses `pbrLightingBit`'s `halfVector`, `nDotH` and
 *   `nDotV`, since both lobes share the normal; another host lighting bit has to provide them under
 *   those names.
 * - `lobePostLighting` dims the base layer under the sheen and adds the direct and environment
 *   sheen.
 *
 * Roughness comes in two tiers. The environment lookup and `sheenE` take the raw value. The direct
 * Charlie term floors it at 0.07, because `pow(sin²θh, 1 / 2α)` with a tiny α sends the exponent
 * huge and underflows on mobile GPUs with 16-bit floats. `charlieD` also floors `sin²θh` at
 * 0.0078125, as Filament's `D_Charlie` does, so `pow` never sees 0. `ashikhminV`'s `1e-5` covers
 * `N·L = N·V = 0`, where its denominator is zero.
 *
 * The base layer is multiplied by `1 - max(sheenColor) * E` so a bright sheen doesn't add energy,
 * and the environment sheen is `sheenColor * sampleEnvironment(R, roughness) * E`, from the shared
 * environment with no separate prefilter. `E` is `sheenE`, clamped to [0, 1]. Its constants are
 * the ones Estevez & Kulla 2017 fit for the `L(x)` curve inside the Charlie visibility term, not a
 * directional-albedo fit, so after the clamp `E` is 1 at grazing angles and falls to 0 toward
 * head-on. Like clearcoat, the environment sheen isn't multiplied by occlusion: occlusion shadows
 * the base surface, and the fibres sit on top of it.
 *
 * `sheenParams` holds the colour in `.rgb` and the roughness in `.w`. One texture slot stands in
 * for the spec's two, colour in `.rgb` and roughness in `.a`, the way assets pack them; when a glTF
 * names two different images, the loader warns and keeps the colour one. Alpha here is data, so
 * the shader undoes pixi's premultiplied upload before sRGB-decoding the colour, as `pbrMaterialBit`
 * does for the base colour. An unset slot holds `Texture.WHITE`, so the multiplies change nothing.
 *
 * Spec: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_sheen
 * @internal
 */
export const sheenBit: ShaderBit = {
  name: 'sheen',

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
#ifndef PIXI3D_SHEEN_HELPERS_DEFINED
#define PIXI3D_SHEEN_HELPERS_DEFINED
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
#endif
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
