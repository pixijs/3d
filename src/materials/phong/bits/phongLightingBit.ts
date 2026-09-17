import { createLightingBit } from '../../../core/shader/createLightingBit';

/**
 * Normalized Blinn-Phong direct lighting
 *
 * Built via {@link createLightingBit} — only the shading math lives here; the
 * light-loop boilerplate (dispatch / attenuation / shadows) is shared.
 *
 * Model:
 *   - Diffuse: PI-normalized Lambert (`albedo / PI`).
 *   - Specular: half-vector Blinn-Phong, energy-normalized by
 *     `(shininess/2 + 1) / PI` (keeps highlight energy ~constant as shininess
 *     changes), with a Fresnel-Schlick term on the specular tint and the
 *     standard implicit geometry factor 0.25.
 *   - Both lobes scaled by irradiance `= light.color * N·L * attenuation * shadow`.
 *   - Ambient `= uGlobalLightParams.xyz * albedo / PI` (the same PI convention
 *     `pbrLightingBit` uses) plus the view environment's irradiance
 *     `sampleEnvironment(normal, 1.0) * albedo` — the consumption shape
 *     `iblBit`'s substrate diffuse uses, so Phong and PBR match brightness
 *     under one rig, hemisphere and cubemap included. There is no specular
 *     env response: classic Phong highlights come from direct lights only.
 *
 * Expects (set by phongMaterialBit + the optional map bits):
 *   - `normal`, `viewDir`, `albedo`, `specularColor`, `shininess`,
 *     `specularStrength`, `emissive`
 *   - `sampleEnvironment(dir, roughness)` from the view's env-source bit —
 *     the material's descriptor must include `view._envBit` (the default
 *     no-env source returns vec3(0) and the term folds away)
 *
 * Writes:
 *   - `finalColor` = ambient + direct (diffuse + specular, one fused
 *     accumulator) + emissive
 * @internal
 */
export const phongLightingBit = createLightingBit({
  name: 'phongLighting',

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
  var directLight = vec3<f32>(0.0);

  let albedoOverPI = albedo * INV_PI;
  // Loop-invariant specular scale: (shininess/2 + 1)/PI energy normalization
  // × 0.25 implicit geometry factor × the scalar/texture specular strength.
  let specScale = (shininess * 0.5 + 1.0) * INV_PI * 0.25 * specularStrength;
`,
    gl: /*glsl*/ `
  vec3 directLight = vec3(0.0);

  vec3 albedoOverPI = albedo * INV_PI;
  float specScale = (shininess * 0.5 + 1.0) * INV_PI * 0.25 * specularStrength;
`,
  },

  perLight: {
    gpu: /*wgsl*/ `
    let halfVector = normalize(viewDir + lightDir);
    let nDotH = max(dot(normal, halfVector), 0.0);
    let vDotH = max(dot(viewDir, halfVector), 0.0);

    // Fresnel-Schlick on the specular tint — spherical-gaussian approximation of
    // the Schlick pow5 (Karis, "Real Shading in UE4"): one exp2 in place of a
    // pow, ~0.0003 max error. Mirrors pbrLightingBit.
    let fc5 = exp2((-5.55473 * vDotH - 6.98316) * vDotH);
    let fresnel = specularColor + (vec3<f32>(1.0) - specularColor) * fc5;
    let specular = fresnel * (specScale * pow(nDotH, shininess));

    let irradiance = light.color * (nDotL * attenuation * shadow);
    directLight += (albedoOverPI + specular) * irradiance;
`,
    gl: /*glsl*/ `
    vec3 halfVector = normalize(viewDir + lightDir);
    float nDotH = max(dot(normal, halfVector), 0.0);
    float vDotH = max(dot(viewDir, halfVector), 0.0);

    float fc5 = exp2((-5.55473 * vDotH - 6.98316) * vDotH);
    vec3 fresnel = specularColor + (vec3(1.0) - specularColor) * fc5;
    vec3 specular = fresnel * (specScale * pow(nDotH, shininess));

    vec3 irradiance = light.color * (nDotL * attenuation * shadow);
    directLight += (albedoOverPI + specular) * irradiance;
`,
  },

  postLighting: {
    gpu: /*wgsl*/ `
  // Flat AmbientLight sum (PI-normalized) + env irradiance consumed as
  // albedo * irradiance — iblBit's substrate-diffuse convention, so Phong and
  // PBR read at matching brightness under one environment.
  let ambient = global.uGlobalLightParams.xyz * albedoOverPI + sampleEnvironment(normal, 1.0) * albedo;
  finalColor = ambient + directLight + emissive;
`,
    gl: /*glsl*/ `
  vec3 ambient = uGlobalLightParams.xyz * albedoOverPI + sampleEnvironment(normal, 1.0) * albedo;
  finalColor = ambient + directLight + emissive;
`,
  },
});
