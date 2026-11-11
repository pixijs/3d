import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Declares the `normal` slot, `normalScale` and `alphaCutoff` for the bits that join per mesh or in
 * `'mask'` mode, since the material's layout is fixed at construction
 * @internal
 */
export const phongMaterialBit: ShaderBit = {
  name: 'phongMaterial',

  textures: ['baseColor', 'normal'],

  bindings: {
    material: {
      baseColor: 'vec4<f32>',
      specularColor: 'vec3<f32>',
      shininess: 'f32',
      specularStrength: 'f32',
      alphaCutoff: 'f32',
      normalScale: 'f32',
    },
  },

  gpu: {
    fragment: {
      material: /*wgsl*/ `
  var emissive: vec3<f32> = vec3<f32>(0.0);
  var specularStrength = material.specularStrength;

  var baseColor = material.baseColor;

  var baseTex = sampleBaseColor(input.vUV);
  let baseTexLinear = baseTex.rgb / max(baseTex.a, 0.001);
  baseTex = vec4<f32>(pow(baseTexLinear, vec3<f32>(2.2)), baseTex.a);
  baseColor *= baseTex;

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  let viewDir = normalize(camera.uCameraPosition.xyz - input.vPosition);
  let specularColor = material.specularColor;
  let shininess = max(material.shininess, 1.0);
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  vec3 emissive = vec3(0.0);
  float specularStrength = material.specularStrength;

  vec4 baseColor = material.baseColor;

  vec4 baseTex = sampleBaseColor(vUV);
  vec3 baseTexLinear = baseTex.rgb / max(baseTex.a, 0.001);
  baseTex.rgb = pow(baseTexLinear, vec3(2.2));
  baseColor *= baseTex;

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  vec3 viewDir = normalize(uCameraPosition.xyz - vPosition);
  vec3 specularColor = material.specularColor;
  float shininess = max(material.shininess, 1.0);
`,
    },
  },
};
