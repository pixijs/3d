import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Reads a Phong material's surface and declares the values `phongLightingBit` shades with
 *
 * Provides `albedo` (base colour in linear light), `viewDir`, `specularColor`, `shininess` (at
 * least 1), `specularStrength` and `emissive`. The last two start at the material's value and at
 * zero; `phongSpecularTextureBit` and `emissiveBit` update them when present.
 *
 * Lighting works in linear light, so the base colour texture is sRGB-decoded with a 2.2 gamma,
 * after undoing pixi's premultiplied upload so the decode sees the straight colour.
 * `pbrMaterialBit` reads its base colour the same way; the unlit `flatMaterialBit` skips the
 * decode. The texture is sampled unconditionally: an unset slot holds `Texture.WHITE`, so the
 * multiply changes nothing.
 *
 * The `normal` slot always exists and holds a flat map by default. The renderer compiles normal
 * mapping in only when the slot holds a real map, so the spare slot costs nothing per fragment. It
 * also keeps mapped and unmapped materials at the same texture count, which the batcher sorts by.
 *
 * The struct declares `normalScale` for the normal-mapping bits to read. Those bits are chosen per
 * mesh, while a material's struct is fixed at construction, so the field has to be here for the
 * struct to come out the same either way. `alphaCutoff` is declared for the same reason, ready for
 * `alphaMaskBit` in `'mask'` mode.
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
