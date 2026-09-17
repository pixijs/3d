import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Image-based environment lighting for the PBR substrate
 *
 * The Karis split-sum approximation ("Real Shading in Unreal Engine 4,"
 * SIGGRAPH 2013) for single scattering, plus Fdez-Agüera multiple-scattering
 * compensation (2019). Same shape as the glTF Sample Renderer's reference
 * implementation, so output should match other compliant PBR renderers within
 * tone-mapping noise.
 *
 * ## Env-agnostic via `sampleEnvironment`
 *
 * Environment radiance reads go through `sampleEnvironment(dir, roughness)`,
 * supplied by whichever env-source bit is in the descriptor — cubemap,
 * hemisphere, or the no-env default. Exactly one env-source bit is always
 * present in a lit PBR descriptor (picked by `View3D.environment`), so
 * the function is always resolvable. All env-specific concerns (texture
 * sampling, sRGB decode, mip-level math) live inside the source bit;
 * `iblBit` itself is source-agnostic.
 *
 * Contract variables (must be set before the `lighting` slot):
 *   - normal, viewDir, albedo, metallic, roughness, fresnelF0, f90
 *
 * Declared by an upstream material bit (typically `pbrMaterialBit`,
 * optionally overridden by `specularBit`) in the `material` slot.
 *
 * Adds to: ambient
 *
 * ## Specular + multiscatter (Fdez-Agüera 2019)
 *
 * Single scatter `FssEss = k_S * scale + f90 * bias` from the BRDF LUT, where
 * `k_S` is a roughness-aware grazing Fresnel (f90 = 1 by default; `specularBit`
 * lowers it for `KHR_materials_specular`). `FmsEms` adds back the multi-bounce
 * energy the single-scatter LUT drops — without it rough metals grey out — lit
 * by the irradiance. Diffuse gets the rest:
 * `kD = albedo * (1 - FssEss - FmsEms) * (1 - metallic)`.
 *
 * ## Diffuse IBL: roughness=1 approximation
 *
 * `roughness = 1` stands in for a cosine-weighted irradiance convolution: it
 * lands on the highest prefiltered mip, which the prefilter normalises by
 * cosine weight, so it already returns ⟨L⟩ ≈ E/π (Lambert's 1/π is baked in).
 * Diffuse is therefore `albedo · ⟨L⟩` — no extra `INV_PI`. Hemisphere and
 * default sources ignore roughness and return their natural value.
 *
 * ## Specular reflection normal (`specularNormal`)
 *
 * The specular env sample reflects off `specularNormal` (set by
 * `pbrMaterialBit`, overwritten by features like anisotropy). Diffuse
 * irradiance and the BRDF `N·V` always use `normal`.
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
  // IBL: single + multiple scattering (Fdez-Agüera) — see iblBit.ts header.
  {
    let NdotV_ibl = max(dot(normal, viewDir), 0.0);
    let R_ibl = reflect(-viewDir, specularNormal);

    let radiance = sampleEnvironment(R_ibl, roughness);
    let irradiance = sampleEnvironment(normal, 1.0);

    let f_ab = textureSampleLevel(uBrdfLutTexture, uBrdfLutSampler, vec2<f32>(NdotV_ibl, roughness), 0.0).rg;

    // Single scattering, with roughness-aware grazing Fresnel.
    let Fr = max(vec3<f32>(1.0 - roughness), fresnelF0) - fresnelF0;
    let k_S = fresnelF0 + Fr * pow(1.0 - NdotV_ibl, 5.0);
    let FssEss = k_S * f_ab.x + f90 * f_ab.y;

    // Multiple scattering: add back the energy the single-scatter LUT dropped.
    let Ems = 1.0 - (f_ab.x + f_ab.y);
    let F_avg = fresnelF0 + (1.0 - fresnelF0) / 21.0;
    let Fms = FssEss * F_avg / (1.0 - F_avg * Ems);
    let FmsEms = Fms * Ems;

    // Diffuse takes the leftover energy; metals contribute none.
    let k_D = albedo * (1.0 - FssEss - FmsEms) * (1.0 - metallic);

    ambient += FssEss * radiance + (FmsEms + k_D) * irradiance;
  }
`,
    },
  },

  gl: {
    fragment: {
      lighting: /*glsl*/ `
  // IBL: single + multiple scattering (Fdez-Agüera) — see iblBit.ts header.
  {
    float NdotV_ibl = max(dot(normal, viewDir), 0.0);
    vec3 R_ibl = reflect(-viewDir, specularNormal);

    vec3 radiance = sampleEnvironment(R_ibl, roughness);
    vec3 irradiance = sampleEnvironment(normal, 1.0);

    vec2 f_ab = texture(uBrdfLutTexture, vec2(NdotV_ibl, roughness)).rg;

    // Single scattering, with roughness-aware grazing Fresnel.
    vec3 Fr = max(vec3(1.0 - roughness), fresnelF0) - fresnelF0;
    vec3 k_S = fresnelF0 + Fr * pow(1.0 - NdotV_ibl, 5.0);
    vec3 FssEss = k_S * f_ab.x + f90 * f_ab.y;

    // Multiple scattering: add back the energy the single-scatter LUT dropped.
    float Ems = 1.0 - (f_ab.x + f_ab.y);
    vec3 F_avg = fresnelF0 + (1.0 - fresnelF0) / 21.0;
    vec3 Fms = FssEss * F_avg / (1.0 - F_avg * Ems);
    vec3 FmsEms = Fms * Ems;

    // Diffuse takes the leftover energy; metals contribute none.
    vec3 k_D = albedo * (1.0 - FssEss - FmsEms) * (1.0 - metallic);

    ambient += FssEss * radiance + (FmsEms + k_D) * irradiance;
  }
`,
    },
  },
};
