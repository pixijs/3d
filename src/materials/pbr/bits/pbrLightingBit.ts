import { mathConstantsBit } from '../../../core/shader/bits/mathConstantsBit';
import { createLightingBit } from '../../../core/shader/createLightingBit';

/**
 * The GGX divide takes no epsilon, which would flatten smooth highlights; `pbrMaterialBit` floors roughness
 * instead. The sheen and anisotropy lobes read this bit's locals, and anisotropy replaces its `specular`
 * @internal
 */
export const pbrLightingBit = createLightingBit({
  name: 'pbrLighting',

  requires: [mathConstantsBit],

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
