import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Floors roughness at 0.045 for `pbrLightingBit`'s unguarded GGX divide. Declares the `normal` slot,
 * `normalScale` and `alphaCutoff` for normal mapping and `alphaMaskBit`, which join after the layout is fixed
 * @internal
 */
export const pbrMaterialBit: ShaderBit = {
  name: 'pbrMaterial',

  textures: ['baseColor', 'metallicRoughness', 'occlusion', 'normal'],
  bindings: {
    material: {
      baseColor: 'vec4<f32>',
      alphaCutoff: 'f32',
      pbrParams: 'vec4<f32>',
      transmissionVolume: 'vec4<f32>',
      attenuationColorIrid: 'vec4<f32>',
      normalScale: 'f32',
    },
  },
  gpu: {
    fragment: {
      material: /*wgsl*/ `
  var viewDir: vec3<f32>;
  var metallic: f32 = 0.0;
  var roughness: f32 = 1.0;
  var fresnelF0: vec3<f32>;
  var f90: f32 = 1.0;
  var emissive: vec3<f32> = vec3<f32>(0.0);
  var occlusion: f32 = 1.0;
  var directLight: vec3<f32> = vec3<f32>(0.0);
  var ambient: vec3<f32> = vec3<f32>(0.0);

  var baseColor = material.baseColor;
  metallic = material.pbrParams.x;
  roughness = material.pbrParams.y;
  occlusion = material.pbrParams.z;

  let ior = material.pbrParams.w;
  let iorRatio = (ior - 1.0) / (ior + 1.0);
  fresnelF0 = vec3<f32>(iorRatio * iorRatio);

  var baseTex = sampleBaseColor(input.vUV);
  let baseTexLinear = baseTex.rgb / max(baseTex.a, 0.001);
  baseTex = vec4<f32>(pow(baseTexLinear, vec3<f32>(2.2)), baseTex.a);
  baseColor *= baseTex;

  let mrTex = sampleMetallicRoughness(input.vUV);
  metallic *= mrTex.b;
  roughness *= mrTex.g;

  occlusion *= sampleOcclusion(input.vUV).r;

  let dNdx = abs(dpdx(normal));
  let dNdy = abs(dpdy(normal));
  let dN = max(dNdx, dNdy);
  let geometricRoughness = max(max(dN.x, dN.y), dN.z);
  roughness = clamp(max(roughness, 0.045) + geometricRoughness, 0.0, 1.0);

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  viewDir = normalize(camera.uCameraPosition.xyz - input.vPosition);
  fresnelF0 = mix(fresnelF0, albedo, metallic);

  var specularNormal = normal;
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  vec3 viewDir;
  float metallic = 0.0;
  float roughness = 1.0;
  vec3 fresnelF0;
  float f90 = 1.0;
  vec3 emissive = vec3(0.0);
  float occlusion = 1.0;
  vec3 directLight = vec3(0.0);
  vec3 ambient = vec3(0.0);

  vec4 baseColor = material.baseColor;
  metallic = material.pbrParams.x;
  roughness = material.pbrParams.y;
  occlusion = material.pbrParams.z;

  float ior = material.pbrParams.w;
  float iorRatio = (ior - 1.0) / (ior + 1.0);
  fresnelF0 = vec3(iorRatio * iorRatio);

  vec4 baseTex = sampleBaseColor(vUV);
  vec3 baseTexLinear = baseTex.rgb / max(baseTex.a, 0.001);
  baseTex.rgb = pow(baseTexLinear, vec3(2.2));
  baseColor *= baseTex;

  vec4 mrTex = sampleMetallicRoughness(vUV);
  metallic *= mrTex.b;
  roughness *= mrTex.g;

  occlusion *= sampleOcclusion(vUV).r;

  vec3 dNdx = abs(dFdx(normal));
  vec3 dNdy = abs(dFdy(normal));
  vec3 dN = max(dNdx, dNdy);
  float geometricRoughness = max(max(dN.x, dN.y), dN.z);
  roughness = clamp(max(roughness, 0.045) + geometricRoughness, 0.0, 1.0);

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;

  viewDir = normalize(uCameraPosition.xyz - vPosition);
  fresnelF0 = mix(fresnelF0, albedo, metallic);

  vec3 specularNormal = normal;
`,
    },
  },
};
