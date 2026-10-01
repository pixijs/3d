import { createLightingBit } from '../../../core/shader/createLightingBit';

/**
 * Cook-Torrance direct lighting for the PBR material, plus the ambient lights' diffuse
 *
 * Built with {@link createLightingBit}, which owns the light loop, attenuation and shadows; this bit
 * supplies only the BRDF. Without it the material shows its `albedo` unlit.
 *
 * Per light:
 *
 * - Distribution: GGX, with `a2 * INV_PI` hoisted out of the loop. The denominator has no guard:
 *   `pbrMaterialBit` floors roughness at 0.045, so it never drops below `a2`, which is above zero.
 *   An added epsilon would swamp `a2²` on smooth surfaces and flatten the highlight instead of
 *   sharpening it.
 * - Visibility: height-correlated Smith GGX with each square root replaced by its linear fit in the
 *   cosine (Hammon 2017). That drops the square roots at the cost of up to about 30% error against
 *   the exact form, worst where light and view both graze. The `max` only covers
 *   `N·L = N·V = 0`, where the lobe is zero anyway.
 * - Fresnel: Schlick's `(1 - x)⁵` in the spherical-Gaussian form `exp2((-5.55473x - 6.98316)x)`
 *   (Karis 2013, "Real Shading in Unreal Engine 4"): one `exp2` instead of a `pow`, never more than
 *   about 0.004 off. `iblBit`, `transmissionBit`, `clearcoatBit`, `iridescenceBit` and
 *   `phongLightingBit` use the same form.
 *
 * Ambient lights add `albedo * (1 - metallic) / PI`: diffuse only, with the same `1 / PI` as the
 * direct diffuse, so an ambient light reads at the same scale as a directional one.
 *
 * Reads `normal`, `viewDir`, `albedo`, `metallic`, `roughness`, `fresnelF0`, `f90`, `occlusion`,
 * `emissive`, `ambient` and `directLight` as `pbrMaterialBit` and the feature bits left them. Adds
 * to `ambient`, fills `directLight`, and writes `finalColor` as
 * `ambient * occlusion + directLight + emissive`. The sheen and anisotropy lobes reuse its loop-wide
 * `nDotV` and `INV_PI` and its per-light `halfVector` and `nDotH`; anisotropy also replaces its
 * `specular`.
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
  directLight = vec3<f32>(0.0);

  ambient += global.uGlobalLightParams.xyz * albedo * (1.0 - metallic) * INV_PI;

  let nDotV = max(dot(normal, viewDir), 0.0);
  let a = roughness * roughness;
  let a2 = a * a;
  let a2_inv_pi = a2 * INV_PI;
  let oneMinusA = 1.0 - a;
  let visV = nDotV * oneMinusA + a;
  let albedoOverPI = albedo * INV_PI;
`,
    gl: /*glsl*/ `
  directLight = vec3(0.0);

  ambient += uGlobalLightParams.xyz * albedo * (1.0 - metallic) * INV_PI;

  float nDotV = max(dot(normal, viewDir), 0.0);
  float a = roughness * roughness;
  float a2 = a * a;
  float a2_inv_pi = a2 * INV_PI;
  float oneMinusA = 1.0 - a;
  float visV = nDotV * oneMinusA + a;
  vec3 albedoOverPI = albedo * INV_PI;
`,
  },

  perLight: {
    gpu: /*wgsl*/ `
    let halfVector = normalize(viewDir + lightDir);
    let hDotV = max(dot(halfVector, viewDir), 0.0);

    let nDotH = max(dot(normal, halfVector), 0.0);
    let dDenom = (nDotH * nDotH * (a2 - 1.0) + 1.0);
    let distribution = a2_inv_pi / (dDenom * dDenom);

    let vis = 0.5 / max(nDotL * visV + nDotV * (nDotL * oneMinusA + a), 1e-6);

    let fc5 = exp2((-5.55473 * hDotV - 6.98316) * hDotV);
    let fresnel = fresnelF0 + (vec3<f32>(f90) - fresnelF0) * fc5;

    let specular = distribution * fresnel * vis;
    let diffuseWeight = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic);

    let radiance = light.color * attenuation;
    directLight += (diffuseWeight * albedoOverPI + specular) * radiance * nDotL * shadow;
`,
    gl: /*glsl*/ `
    vec3 halfVector = normalize(viewDir + lightDir);
    float hDotV = max(dot(halfVector, viewDir), 0.0);

    float nDotH = max(dot(normal, halfVector), 0.0);
    float dDenom = (nDotH * nDotH * (a2 - 1.0) + 1.0);
    float distribution = a2_inv_pi / (dDenom * dDenom);

    float vis = 0.5 / max(nDotL * visV + nDotV * (nDotL * oneMinusA + a), 1e-6);

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
