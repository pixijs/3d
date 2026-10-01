import { createLightingBit } from '../../../core/shader/createLightingBit';

/**
 * Blinn-Phong lighting, normalized to read at the same brightness as `pbrLightingBit`
 *
 * Built with {@link createLightingBit}, which owns the light loop, attenuation and shadows; this bit
 * supplies only the shading.
 *
 * - Diffuse is Lambert, `albedo / PI`.
 * - Specular is `pow(N·H, shininess)` around the half vector, scaled by `(shininess / 2 + 1) / PI`
 *   to keep the highlight's energy roughly steady as shininess changes, by 0.25 for the implicit
 *   geometry term, and by `specularStrength`. Those three fold into `specScale` once per fragment.
 *   Fresnel-Schlick tints it from `specularColor`, in the spherical-Gaussian form `pbrLightingBit`
 *   documents.
 * - Both lobes take `light.color * N·L * attenuation * shadow`.
 * - Ambient is the ambient lights' sum times `albedo / PI`, plus the view environment's
 *   `sampleEnvironment(normal, 1.0) * albedo`, the form `iblBit` uses for diffuse, so Phong and PBR
 *   match under one environment. There is no environment specular.
 *
 * Reads the surface `normal`, `sampleEnvironment` from the view's environment bit (which the
 * descriptor must include; with no environment it returns zero), and `viewDir`, `albedo`,
 * `specularColor`, `shininess`, `specularStrength` and `emissive` from `phongMaterialBit`. Writes
 * `finalColor` as ambient plus direct light plus emissive.
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
  let ambient = global.uGlobalLightParams.xyz * albedoOverPI + sampleEnvironment(normal, 1.0) * albedo;
  finalColor = ambient + directLight + emissive;
`,
    gl: /*glsl*/ `
  vec3 ambient = uGlobalLightParams.xyz * albedoOverPI + sampleEnvironment(normal, 1.0) * albedo;
  finalColor = ambient + directLight + emissive;
`,
  },
});
