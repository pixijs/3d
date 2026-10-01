import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Environment lighting for the PBR surface: specular and diffuse from the view's environment
 *
 * Karis's split-sum approximation ("Real Shading in Unreal Engine 4", SIGGRAPH 2013) for single
 * scattering, plus Fdez-Agüera's multiple-scattering compensation (2019):
 *
 * - `k_S` is a roughness-aware Fresnel, `F0 + (max(1 - roughness, F0) - F0) * fc5`, with the
 *   spherical-Gaussian Schlick `pbrLightingBit` documents.
 * - Single scattering is `FssEss = k_S * lut.x + f90 * lut.y`, from the BRDF lookup table.
 * - `FmsEms` adds back the energy the single-scatter table loses to further bounces, lit by the
 *   irradiance; without it rough metals turn grey. The `1e-5` keeps its denominator off zero when
 *   `F_avg` and `Ems` both near 1.
 * - Diffuse takes what is left: `k_D = albedo * (1 - FssEss - FmsEms) * (1 - metallic)`.
 *
 * Every environment read goes through `sampleEnvironment(dir, roughness)`, which the view's
 * environment bit supplies, so this bit works the same for a cube map and a hemisphere. Material3D
 * leaves it out when the view has no environment. The specular sample reflects off
 * `specularNormal`, which the anisotropy bit may bend; the irradiance and the table's `N·V` use
 * `normal`.
 *
 * Irradiance is the environment sampled at roughness 1. For a cube map that is the most blurred
 * prefiltered mip, a cosine-weighted average of radiance, which is already about irradiance / PI,
 * so the diffuse term takes no extra `1 / PI`. A hemisphere ignores roughness.
 *
 * Reads `normal`, `viewDir`, `albedo`, `metallic`, `roughness`, `fresnelF0`, `f90` and
 * `specularNormal`, which must be final before the `lighting` slot, and adds to `ambient`.
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

    let Fr = max(vec3<f32>(1.0 - roughness), fresnelF0) - fresnelF0;
    let k_S = fresnelF0 + Fr * exp2((-5.55473 * NdotV_ibl - 6.98316) * NdotV_ibl);
    let FssEss = k_S * f_ab.x + f90 * f_ab.y;

    let Ems = 1.0 - (f_ab.x + f_ab.y);
    let F_avg = fresnelF0 + (1.0 - fresnelF0) / 21.0;
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

    vec3 Fr = max(vec3(1.0 - roughness), fresnelF0) - fresnelF0;
    vec3 k_S = fresnelF0 + Fr * exp2((-5.55473 * NdotV_ibl - 6.98316) * NdotV_ibl);
    vec3 FssEss = k_S * f_ab.x + f90 * f_ab.y;

    float Ems = 1.0 - (f_ab.x + f_ab.y);
    vec3 F_avg = fresnelF0 + (1.0 - fresnelF0) / 21.0;
    vec3 Fms = FssEss * F_avg / (1.0 - F_avg * Ems + 1e-5);
    vec3 FmsEms = Fms * Ems;

    vec3 k_D = albedo * (1.0 - FssEss - FmsEms) * (1.0 - metallic);

    ambient += FssEss * radiance + (FmsEms + k_D) * irradiance;
  }
`,
    },
  },
};
