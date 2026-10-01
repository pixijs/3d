import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Reads a PBR material's surface and declares the values the PBR bits after it share
 *
 * Reads `normal` and the `material` row from the template. Provides `albedo`, `alpha`, `metallic`,
 * `roughness`, `occlusion`, `fresnelF0` and `viewDir`, plus these, which later bits may change:
 *
 * - `f90`: 1 unless `specularBit` lowers it.
 * - `emissive`: zero until `emissiveBit` or `transmissionBit` writes it, so a material without
 *   those features samples no emissive texture and adds nothing.
 * - `specularNormal`: the normal the environment's specular reflection uses; `normal` unless the
 *   anisotropy bit bends it.
 * - `directLight` and `ambient`: zero, for the lighting bits to add to.
 * - `geometricRoughness`: see below; `clearcoatBit` reuses it.
 *
 * Both backends declare the same set; keep them in step.
 *
 * The base colour texture is sRGB-decoded as `phongMaterialBit` describes. Roughness comes from the
 * green channel of the metallic-roughness map and metalness from the blue, as in glTF, and
 * occlusion from the red channel of its map. Every texture is sampled unconditionally: an unset slot
 * holds `Texture.WHITE`, so the multiply changes nothing.
 *
 * ## F0 from IOR (KHR_materials_ior)
 *
 * The dielectric `fresnelF0` is `((ior - 1) / (ior + 1))²`, with `ior` from `pbrParams.w`, which
 * gives exactly 0.04 at the default 1.5. Metals then replace it with `albedo` through
 * `mix(F0, albedo, metallic)`.
 *
 * ## Geometric specular antialiasing
 *
 * Kaplanyan & Hofmann 2016, "Stable Geometric Specular Antialiasing", in its simplified
 * screen-derivative form: `geometricRoughness` is how fast the normal swings across a pixel, and it
 * is added to roughness. That widens the highlight on the silhouettes of curved meshes and on small
 * distant detail, which would otherwise sparkle. The normal it reads is the one the bits before it
 * left: the renderer adds normal mapping, flat shading and the double-sided flip ahead of the
 * material's own bits, so normal-map detail raises roughness too.
 *
 * Roughness is floored at 0.045 before that. The floor keeps the GGX denominator in
 * `pbrLightingBit` above zero, which is why that bit divides without a guard.
 *
 * The `normal` slot, `normalScale` and `alphaCutoff` are declared for the reasons
 * `phongMaterialBit` gives.
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
