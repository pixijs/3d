import { createLightingBit } from '../../../core/shader/createLightingBit';

/**
 * Physically-based direct lighting using the Cook-Torrance BRDF
 *
 * Built via {@link createLightingBit} — only the BRDF math lives here;
 * the light-loop boilerplate (dispatch / attenuation / shadows) is shared.
 *
 * Without this bit: material is "unlit" (shows albedo directly).
 * With this bit: full PBR direct lighting + ambient.
 *
 * Expects these contract variables to be set before the lighting slot:
 *   - `normal`      vec3  – world-space normal
 *   - `viewDir`     vec3  – view direction (normalized)
 *   - `albedo`      vec3  – base color (linear space)
 *   - `metallic`    f32
 *   - `roughness`   f32
 *   - `fresnelF0`   vec3
 *   - `f90`         f32   – default 1.0; `specularBit` overrides for KHR_materials_specular
 *
 * Writes:
 *   - `ambient`     vec3  – ambient contribution
 *   - `directLight` vec3  – accumulated direct lighting
 *   - `finalColor`  vec3  – `(ambient * occlusion) + directLight + emissive`
 * @internal
 */
export const pbrLightingBit = createLightingBit({
  name: 'pbrLighting',

  header: {
    gpu: /*wgsl*/ `
const INV_PI: f32 = 0.31830988618;
`,
    gl: /*glsl*/ `
const float INV_PI = 0.31830988618;
`,
  },

  preLighting: {
    gpu: /*wgsl*/ `
  // PBR Lighting (ambient + direct)
  // Reset default (template sets directLight = albedo for unlit fallback)
  directLight = vec3<f32>(0.0);

  // Ambient lighting — diffuse only, so metals are excluded. The INV_PI
  // Lambertian normalization matches the direct-light diffuse (albedoOverPI),
  // so an AmbientLight reads at the same energy scale as a directional light.
  ambient += global.uGlobalLightParams.xyz * albedo * (1.0 - metallic) * INV_PI;

  // Cache PBR variables outside loop (hoisted math)
  let nDotV = max(dot(normal, viewDir), 0.0);
  let a = roughness * roughness;
  let a2 = a * a;
  let a2_inv_pi = a2 * INV_PI;
  let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  let oneMinusK = 1.0 - k;
  let vis_V = 1.0 / (nDotV * oneMinusK + k);
  let albedoOverPI = albedo * INV_PI;
`,
    gl: /*glsl*/ `
  // PBR Lighting (ambient + direct)
  directLight = vec3(0.0);

  // Ambient lighting — diffuse only, so metals are excluded. The INV_PI
  // Lambertian normalization matches the direct-light diffuse (albedoOverPI),
  // so an AmbientLight reads at the same energy scale as a directional light.
  ambient += uGlobalLightParams.xyz * albedo * (1.0 - metallic) * INV_PI;

  float nDotV = max(dot(normal, viewDir), 0.0);
  float a = roughness * roughness;
  float a2 = a * a;
  float a2_inv_pi = a2 * INV_PI;
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float oneMinusK = 1.0 - k;
  float vis_V = 1.0 / (nDotV * oneMinusK + k);
  vec3 albedoOverPI = albedo * INV_PI;
`,
  },

  perLight: {
    gpu: /*wgsl*/ `
    // Cook-Torrance BRDF
    let halfVector = normalize(viewDir + lightDir);
    let hDotV = max(dot(halfVector, viewDir), 0.0);

    // 1. Distribution (GGX) — uses precomputed a2 * INV_PI
    let nDotH = max(dot(normal, halfVector), 0.0);
    let dDenom = (nDotH * nDotH * (a2 - 1.0) + 1.0);
    // 1e-5 (not 1e-7) because mobile fragment math at mediump (FP16) flushes
    // values below ~6e-5 to zero, which would NaN the GGX denominator.
    let distribution = a2_inv_pi / (dDenom * dDenom + 1e-5);

    // 2. Visibility (Schlick-GGX Smith)
    let vis_L = 1.0 / (nDotL * oneMinusK + k);
    let vis = 0.25 * vis_V * vis_L;

    // 3. Fresnel (Spherical Gaussian approximation of Schlick pow5).
    // Replaces 3 dependent multiplies with 1 MAD + 1 MUL + 1 hardware exp2;
    // max error vs. the literal pow5 is ~0.0003 across [0, 1]. Unreal Engine
    // has shipped this since 2013 — see Karis, "Real Shading in UE4" §3.2.
    let fc5 = exp2((-5.55473 * hDotV - 6.98316) * hDotV);
    let fresnel = fresnelF0 + (vec3<f32>(f90) - fresnelF0) * fc5;

    let specular = distribution * fresnel * vis;
    let diffuseWeight = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic);

    let radiance = light.color * attenuation;
    directLight += (diffuseWeight * albedoOverPI + specular) * radiance * nDotL * shadow;
`,
    gl: /*glsl*/ `
    // Cook-Torrance BRDF
    vec3 halfVector = normalize(viewDir + lightDir);
    float hDotV = max(dot(halfVector, viewDir), 0.0);

    float nDotH = max(dot(normal, halfVector), 0.0);
    float dDenom = (nDotH * nDotH * (a2 - 1.0) + 1.0);
    // 1e-5 (not 1e-7) because mobile fragment math at mediump (FP16) flushes
    // values below ~6e-5 to zero, which would NaN the GGX denominator.
    float distribution = a2_inv_pi / (dDenom * dDenom + 1e-5);

    float vis_L = 1.0 / (nDotL * oneMinusK + k);
    float vis = 0.25 * vis_V * vis_L;

    // Spherical Gaussian approximation of Schlick pow5 — see WGSL counterpart.
    float fc5 = exp2((-5.55473 * hDotV - 6.98316) * hDotV);
    vec3 fresnel = fresnelF0 + (vec3(f90) - fresnelF0) * fc5;

    vec3 specular = distribution * fresnel * vis;
    vec3 diffuseWeight = (vec3(1.0) - fresnel) * (1.0 - metallic);

    vec3 radiance = light.color * attenuation;
    directLight += (diffuseWeight * albedoOverPI + specular) * radiance * nDotL * shadow;
`,
  },

  postLighting: {
    gpu: /*wgsl*/ `
  finalColor = (ambient * occlusion) + directLight + emissive;
`,
    gl: /*glsl*/ `
  finalColor = (ambient * occlusion) + directLight + emissive;
`,
  },
});
