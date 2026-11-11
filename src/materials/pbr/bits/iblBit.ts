import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Every Fresnel term uses `f90` where Schlick has 1, to match `specularBit` and `pbrLightingBit`. The environment
 * sampled at roughness 1 is already about irradiance / PI, so diffuse takes no `1 / PI`
 * @internal
 */
export const iblBit: ShaderBit = {
  name: 'ibl',

  bindings: {
    global: {
      uBrdfLutTexture: 'texture_2d<f32>',
    },
  },

  gpu: {
    fragment: {
      lighting: /*wgsl*/ `
  {
    let NdotV_ibl = max(dot(normal, viewDir), 0.0);
    let R_ibl = reflect(-viewDir, specularNormal);

    let radiance = sampleEnvironment(R_ibl, roughness);
    let irradiance = sampleEnvironment(normal, 1.0);

    let f_ab = textureSampleLevel(uBrdfLutTexture, uBrdfLutSampler, vec2<f32>(NdotV_ibl, roughness), 0.0).rg;

    let Fr = max(vec3<f32>(f90 - f90 * roughness), fresnelF0) - fresnelF0;
    let k_S = fresnelF0 + Fr * exp2((-5.55473 * NdotV_ibl - 6.98316) * NdotV_ibl);
    let FssEss = k_S * f_ab.x + f90 * f_ab.y;

    let Ems = 1.0 - (f_ab.x + f_ab.y);
    let F_avg = fresnelF0 + (f90 - fresnelF0) / 21.0;
    let Fms = FssEss * F_avg / (1.0 - F_avg * Ems + 1e-5);
    let FmsEms = Fms * Ems;

    let k_D = albedo * (1.0 - FssEss - FmsEms) * (1.0 - metallic);

    ambient += FssEss * radiance + (FmsEms + k_D) * irradiance;
  }
`,
    },
  },

  gl: {
    fragment: {
      lighting: /*glsl*/ `
  {
    float NdotV_ibl = max(dot(normal, viewDir), 0.0);
    vec3 R_ibl = reflect(-viewDir, specularNormal);

    vec3 radiance = sampleEnvironment(R_ibl, roughness);
    vec3 irradiance = sampleEnvironment(normal, 1.0);

    vec2 f_ab = texture(uBrdfLutTexture, vec2(NdotV_ibl, roughness)).rg;

    vec3 Fr = max(vec3(f90 - f90 * roughness), fresnelF0) - fresnelF0;
    vec3 k_S = fresnelF0 + Fr * exp2((-5.55473 * NdotV_ibl - 6.98316) * NdotV_ibl);
    vec3 FssEss = k_S * f_ab.x + f90 * f_ab.y;

    float Ems = 1.0 - (f_ab.x + f_ab.y);
    vec3 F_avg = fresnelF0 + (f90 - fresnelF0) / 21.0;
    vec3 Fms = FssEss * F_avg / (1.0 - F_avg * Ems + 1e-5);
    vec3 FmsEms = Fms * Ems;

    vec3 k_D = albedo * (1.0 - FssEss - FmsEms) * (1.0 - metallic);

    ambient += FssEss * radiance + (FmsEms + k_D) * irradiance;
  }
`,
    },
  },
};
