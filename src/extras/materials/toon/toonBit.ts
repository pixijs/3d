import { createLightingBit } from '../../../core/shader/createLightingBit';
import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Sets up the inputs {@link toonLightingBit} reads
 *
 * Declares the `baseColor` texture slot and the fields {@link ToonData} lists, tints `albedo` and
 * `alpha` by the base colour and its texture, and declares `viewDir` and the toon values for the
 * lighting bit. The texture is sampled only on geometry with UVs.
 * @category extras:materials
 * @advanced
 */
export const toonMaterialBit: ShaderBit = {
  name: 'toonMaterial',

  textures: ['baseColor'],

  bindings: {
    material: {
      baseColor: 'vec4<f32>',
      bands: 'f32',
      specularSize: 'f32',
      rimPower: 'f32',
      rimIntensity: 'f32',
      alphaCutoff: 'f32',
    },
  },

  gpu: {
    fragment: {
      material: /*wgsl*/ `
  var baseColor = material.baseColor;

  if (HAS_UVS == 1) {
    var baseTex = sampleBaseColor(input.vUV);
    baseTex = vec4<f32>(baseTex.rgb / max(baseTex.a, 0.001), baseTex.a);
    baseColor *= baseTex;
  }

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  var viewDir = normalize(camera.uCameraPosition.xyz - input.vPosition);
  let bands = max(material.bands, 1.0);
  let specularSize = material.specularSize;
  let rimPower = material.rimPower;
  let rimIntensity = material.rimIntensity;
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  vec4 baseColor = material.baseColor;

  if (HAS_UVS == 1) {
    vec4 baseTex = sampleBaseColor(vUV);
    baseTex.rgb /= max(baseTex.a, 0.001);
    baseColor *= baseTex;
  }

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  vec3 viewDir = normalize(uCameraPosition.xyz - vPosition);
  float bands = max(material.bands, 1.0);
  float specularSize = material.specularSize;
  float rimPower = material.rimPower;
  float rimIntensity = material.rimIntensity;
`,
    },
  },
};

/**
 * Cel-shaded lighting: quantised diffuse bands, a stepped specular highlight and a rim term
 *
 * Needs the `viewDir` and toon values {@link toonMaterialBit} declares, so use the two together.
 * It's built with {@link createLightingBit}, which supplies the light loop and shadows.
 * @category extras:materials
 * @advanced
 */
export const toonLightingBit = createLightingBit({
  name: 'toonLighting',

  preLighting: {
    gpu: /*wgsl*/ `
  var diffuseLight = vec3<f32>(0.0);
  var specLight = vec3<f32>(0.0);

  let ambientColor = global.uGlobalLightParams.xyz;
  diffuseLight += ambientColor * 0.4;
`,
    gl: /*glsl*/ `
  vec3 diffuseLight = vec3(0.0);
  vec3 specLight = vec3(0.0);

  diffuseLight += uGlobalLightParams.xyz * 0.4;
`,
  },

  perLight: {
    gpu: /*wgsl*/ `
    let litAmount = nDotL * attenuation * shadow;

    let quantized = floor(litAmount * bands + 0.5) / bands;
    diffuseLight += light.color * quantized;

    let halfVector = normalize(viewDir + lightDir);
    let nDotH = max(dot(normal, halfVector), 0.0);
    let specStep = smoothstep(1.0 - specularSize - 0.02, 1.0 - specularSize, nDotH);
    specLight += light.color * specStep * shadow * step(0.01, litAmount);
`,
    gl: /*glsl*/ `
    float litAmount = nDotL * attenuation * shadow;

    float quantized = floor(litAmount * bands + 0.5) / bands;
    diffuseLight += light.color * quantized;

    vec3 halfVector = normalize(viewDir + lightDir);
    float nDotH = max(dot(normal, halfVector), 0.0);
    float specStep = smoothstep(1.0 - specularSize - 0.02, 1.0 - specularSize, nDotH);
    specLight += light.color * specStep * shadow * step(0.01, litAmount);
`,
  },

  postLighting: {
    gpu: /*wgsl*/ `
  let nDotV = max(dot(normal, viewDir), 0.0);
  let rimFactor = pow(1.0 - nDotV, rimPower) * rimIntensity;

  finalColor = albedo * diffuseLight + specLight * 0.5 + vec3<f32>(rimFactor);
`,
    gl: /*glsl*/ `
  float nDotV = max(dot(normal, viewDir), 0.0);
  float rimFactor = pow(1.0 - nDotV, rimPower) * rimIntensity;

  finalColor = albedo * diffuseLight + specLight * 0.5 + vec3(rimFactor);
`,
  },
});
