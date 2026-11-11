import { mathConstantsBit } from '../../../core/shader/bits/mathConstantsBit';
import { createLightingBit } from '../../../core/shader/createLightingBit';

/**
 * Normalized to read as bright as `pbrLightingBit`, and takes the environment's diffuse as `iblBit`
 * does, with no `1 / PI`, so Phong and PBR meshes match under the same lights
 * @internal
 */
export const phongLightingBit = createLightingBit({
  name: 'phongLighting',

  requires: [mathConstantsBit],

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
