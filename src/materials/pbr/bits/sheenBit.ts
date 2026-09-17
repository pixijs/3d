import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * KHR_materials_sheen shader bit
 *
 * Adds a soft retroreflective grazing-angle lobe on top of the base PBR
 * material — the fuzzy halo you get on velvet, satin, brushed cotton, peach
 * skin, and fabric in general. Uses the Charlie NDF + Ashikhmin visibility
 * BRDF recommended by the glTF spec's appendix.
 *
 * ## Architecture: a "lobe" emitted into the existing light loop
 *
 * Same convention as `clearcoatBit` — this bit splices three snippets
 * into `pbrLightingBit`'s loop via `createLightingBit`:
 *
 *  - `lobePreLighting`  — sample sheen color/roughness, declare accumulator.
 *  - `lobePerLight`     — Charlie * Ashikhmin for this light's sheen lobe.
 *  - `lobePostLighting` — composite: attenuate base by sheen directional
 *                         albedo, add sheen direct + sheen IBL.
 *
 * So a sheen material still runs **one** light loop, samples each shadow map
 * exactly **once**, and pays only the per-iteration cost of the Charlie /
 * Ashikhmin math on top of Cook-Torrance. There is no second `for (i in
 * lights)` and no second shadow lookup.
 *
 * ## Required upstream state
 *
 * Set by `pbrMaterialBit` / `pbrLightingBit` / `createLightingBit` before
 * this bit runs:
 *   - `material`                 — Material struct (needs `sheenParams`)
 *   - `normal`, `viewDir`        — surface frame (no separate sheen normal)
 *   - `nDotV`, `INV_PI`          — declared by `pbrLightingBit` preLighting / header
 *   - `halfVector`, `nDotH`      — declared by `pbrLightingBit` inside the light loop
 *   - `lightDir`, `light`,
 *     `attenuation`, `shadow`,
 *     `nDotL`                    — declared by the factory inside the loop
 *   - `finalColor`               — base PBR result, attenuated in lobePost
 *   - `input.vUV` / `vUV`        — texture coordinates
 *
 * Sheen reuses `halfVector` and `nDotH` straight from `pbrLightingBit.perLight`
 * rather than recomputing its own (the same surface normal drives both lobes).
 * This saves one `normalize()` + one `dot()` per light per fragment. If you
 * pair `sheenBit` with a different lighting bit, that bit must provide
 * `halfVector` and `nDotH` under those exact names.
 *
 * ## Single packed texture slot
 *
 * The glTF spec defines two binding points (`sheenColorTexture` for RGB and
 * `sheenRoughnessTexture` for alpha), but the standard packing is a single
 * image with color in RGB and roughness in A. We expose ONE slot (`sheen`)
 * and sample `.rgb` for color + `.a` for roughness. This saves a batch
 * texture slot and a texture index. The material's default `Texture.WHITE`
 * decodes to `(1,1,1,1)` so factor-only materials (no texture supplied)
 * work uniformly — the shader always samples.
 *
 * If a glTF asset unusually supplies two *different* texture references,
 * `processMaterials.ts` warns and uses the color texture (roughness falls
 * back to the factor-only path).
 *
 * Because sheen `.a` is roughness (data), not coverage, we must undo pixi's
 * default premultiplied-alpha upload before reading `.rgb` — otherwise color
 * arrives scaled by roughness. Same pattern `pbrMaterialBit` uses for
 * baseColor / emissive: `rgb / max(a, 0.001)` then the gamma 2.2 sRGB decode.
 *
 * ## Two-tier roughness
 *
 * Like `clearcoatBit`, we derive two roughness values from the same source:
 *
 *  - `sheenRoughnessIBL` — raw [0..1], used for env-map mip selection and
 *    the directional-albedo `sheenE(NdotV, r)` lookup.
 *  - `sheenRoughness`    — `max(sheenRoughnessIBL, 0.07)`, used only by the
 *    direct Charlie math. `pow(sin2h, 1/(2α))` with α very small sends the
 *    exponent huge and underflows on FP16 mobile GPUs; the 0.07 minimum
 *    keeps it stable without touching the IBL path.
 *
 * ## Energy conservation
 *
 * The base PBR lobe is attenuated by `1 - max(sheenColor.rgb) * E(NdotV, r)`
 * before the sheen contribution is added. `E(NdotV, r)` is the Charlie
 * lobe's directional albedo — the integrated fraction of incoming light the
 * sheen redirects. Without this attenuation, strong white sheen would brighten
 * the total output past energy conservation at grazing angles.
 *
 * We use the Estevez & Kulla 2017 analytical fit for `E` instead of a
 * precomputed Charlie LUT. The fit is ~6 shader instructions and avoids
 * plumbing a new texture binding through the IBL path — the visible
 * difference vs. a 32×32 LUT is negligible for fabric-style materials. If
 * you ever need LUT-grade accuracy, swap the `sheenE()` helper for a
 * `textureSample(uSheenELutTexture, …).r` and bind the LUT alongside
 * `uBrdfLutTexture`.
 *
 * ## IBL: prefiltered env at the sheen roughness mip
 *
 * Sheen IBL is `sheenColor * prefiltered(sheenRoughness) * E(NdotV, r)` —
 * we reuse the shared `uEnvironmentTexture` mip chain (no separate Charlie
 * prefilter), which is the same simplification the Khronos reference
 * renderer accepts when energy-conservation accuracy isn't critical.
 *
 * As with clearcoat, sheen IBL is **not** multiplied by occlusion. AO
 * shadows the substrate; the fabric fibers scatter light regardless.
 *
 * ## Per-material data
 *
 * Packed into one `vec4<f32>` (`sheenParams`):
 *
 * | channel | meaning                                           |
 * |---------|---------------------------------------------------|
 * | `.x`    | sheenColorFactor R — tint red component           |
 * | `.y`    | sheenColorFactor G — tint green component         |
 * | `.z`    | sheenColorFactor B — tint blue component          |
 * | `.w`    | sheenRoughnessFactor — sheen lobe roughness [0,1] |
 *
 * The texture (`sheen`) defaults to `Texture.WHITE` so materials without a
 * packed sheen texture still sample unconditionally with no visual effect.
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
// Charlie NDF, split so the light-independent factor is hoisted per fragment.
// charlieScale = (2 + 1/α) · (2π)⁻¹ and invAlphaHalf = 1/(2α) are precomputed
// once in lobePreLighting; the per-light call is a single pow + mul.
fn charlieD(charlieScale: f32, invAlphaHalf: f32, NdotH: f32) -> f32 {
  let cos2h = NdotH * NdotH;
  // 0.0078125 matches the Khronos reference — keeps pow() finite at NdotH→1.
  let sin2h = max(1.0 - cos2h, 0.0078125);
  return charlieScale * pow(sin2h, invAlphaHalf);
}

fn ashikhminV(NdotL: f32, NdotV: f32) -> f32 {
  // 1e-5 keeps the denominator safe when fragment math is promoted to FP16
  // on mobile — mirrors pbrLightingBit's mediump hardening.
  return 1.0 / (4.0 * (NdotL + NdotV - NdotL * NdotV) + 1e-5);
}

// Estevez-Kulla 2017 analytical fit for the Charlie directional albedo.
// Max error vs. a 32x32 LUT is ~1% across the fabric-relevant domain.
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
  // KHR_materials_sheen — see sheenBit.ts for packing / colour-space rationale.
  let sheenTex = sampleSheen(input.vUV);
  // Undo premultiplied-alpha upload (alpha here is roughness, not coverage)
  // and apply the gamma 2.2 sRGB decode — same treatment baseColor receives
  // in pbrMaterialBit.
  let sheenTexStraight = sheenTex.rgb / max(sheenTex.a, 0.001);
  let sheenTexColor = pow(sheenTexStraight, vec3<f32>(2.2));
  let sheenColor = material.sheenParams.rgb * sheenTexColor;

  // Two-tier roughness: IBL path sees the raw [0,1] value; only the Charlie
  // direct-lighting math needs a minimum clamp for numerical stability.
  let sheenRoughnessIBL = clamp(material.sheenParams.a * sheenTex.a, 0.0, 1.0);
  let sheenRoughness = max(sheenRoughnessIBL, 0.07);
  let sheenAlpha = sheenRoughness * sheenRoughness;
  // Hoist Charlie's light-independent factors — the per-light call reduces
  // to a single pow + mul. (2π)⁻¹ = INV_PI · 0.5.
  let sheenInvAlpha = 1.0 / sheenAlpha;
  let sheenInvAlphaHalf = sheenInvAlpha * 0.5;
  let sheenCharlieScale = (2.0 + sheenInvAlpha) * INV_PI * 0.5;
  // Also hoist the RGB-max used by the postLighting base-lobe attenuation —
  // it's light-independent, so no reason to recompute it.
  let sheenMax = max(sheenColor.r, max(sheenColor.g, sheenColor.b));

  var sheenLight = vec3<f32>(0.0);
`,
      lobePerLight: /*wgsl*/ `
    // Sheen: Charlie NDF + Ashikhmin V, no Fresnel, no metallic scaling.
    // Reuses halfVector + nDotH from pbrLightingBit.perLight (same surface
    // normal drives both lobes) — saves one normalize + one dot per light.
    {
      let shD = charlieD(sheenCharlieScale, sheenInvAlphaHalf, nDotH);
      let shV = ashikhminV(nDotL, nDotV);
      sheenLight += sheenColor * shD * shV * nDotL * light.color * attenuation * shadow;
    }
`,
      lobePostLighting: /*wgsl*/ `
  // Sheen composite — see sheenBit.ts for IBL / AO / two-tier roughness rationale.
  let shR = reflect(-viewDir, normal);
  // Env radiance via the active env-source bit.
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
// Charlie NDF, split so the light-independent factor is hoisted per fragment.
// See the WGSL version for rationale.
float charlieD(float charlieScale, float invAlphaHalf, float NdotH) {
  float cos2h = NdotH * NdotH;
  float sin2h = max(1.0 - cos2h, 0.0078125);
  return charlieScale * pow(sin2h, invAlphaHalf);
}

float ashikhminV(float NdotL, float NdotV) {
  // 1e-5 keeps denominator safe under mediump promotion — see pbrLightingBit.
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
  // KHR_materials_sheen — see sheenBit.ts for packing / colour-space rationale.
  vec4 sheenTex = sampleSheen(vUV);
  // Undo premultiplied-alpha upload + gamma 2.2 sRGB decode — matches the
  // treatment baseColor receives in pbrMaterialBit.
  vec3 sheenTexStraight = sheenTex.rgb / max(sheenTex.a, 0.001);
  vec3 sheenTexColor = pow(sheenTexStraight, vec3(2.2));
  vec3 sheenColor = material.sheenParams.rgb * sheenTexColor;

  // Two-tier roughness: IBL / sheenE see the raw [0,1] value; only the
  // Charlie direct path needs a minimum clamp for numerical stability.
  float sheenRoughnessIBL = clamp(material.sheenParams.a * sheenTex.a, 0.0, 1.0);
  float sheenRoughness = max(sheenRoughnessIBL, 0.07);
  float sheenAlpha = sheenRoughness * sheenRoughness;
  // Hoist Charlie's light-independent factors — the per-light call reduces
  // to a single pow + mul. (2π)⁻¹ = INV_PI · 0.5.
  float sheenInvAlpha = 1.0 / sheenAlpha;
  float sheenInvAlphaHalf = sheenInvAlpha * 0.5;
  float sheenCharlieScale = (2.0 + sheenInvAlpha) * INV_PI * 0.5;
  // Also hoist the RGB-max used by the postLighting base-lobe attenuation —
  // it's light-independent.
  float sheenMax = max(sheenColor.r, max(sheenColor.g, sheenColor.b));

  vec3 sheenLight = vec3(0.0);
`,
      lobePerLight: /*glsl*/ `
    // Sheen: Charlie NDF + Ashikhmin V, no Fresnel, no metallic scaling.
    // Reuses halfVector + nDotH from pbrLightingBit.perLight — saves one
    // normalize + one dot per light.
    {
      float shD = charlieD(sheenCharlieScale, sheenInvAlphaHalf, nDotH);
      float shV = ashikhminV(nDotL, nDotV);
      sheenLight += sheenColor * shD * shV * nDotL * light.color * attenuation * shadow;
    }
`,
      lobePostLighting: /*glsl*/ `
  // Sheen composite — see sheenBit.ts for IBL / AO / two-tier roughness rationale.
  vec3 shR = reflect(-viewDir, normal);
  // Env radiance via the active env-source bit.
  vec3 shPref = sampleEnvironment(shR, sheenRoughnessIBL);
  float shE = clamp(sheenE(nDotV, sheenRoughnessIBL), 0.0, 1.0);
  vec3 sheenIBL = sheenColor * shPref * shE;
  float sheenAlbedoScale = 1.0 - sheenMax * shE;
  finalColor = finalColor * sheenAlbedoScale + sheenLight + sheenIBL;
`,
    },
  },
};
