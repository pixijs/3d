import type { ShaderBit } from '../ShaderBit';

/**
 * Sets `emissive` to the material's emissive colour times `emissiveStrength` and the sRGB-decoded
 * emissive texture
 *
 * It is a bit of its own so a material with no emissive reads no extra fields and samples no extra
 * texture. It assigns the `emissive` that `pbrMaterialBit` and `phongMaterialBit` declare as zero,
 * so it comes after them, and before any bit that adds to `emissive`, as `transmissionBit` does.
 * The lighting bit then adds `emissive` to `finalColor`.
 *
 * `emissiveStrength` is `KHR_materials_emissive_strength`. Core glTF caps `emissiveFactor` at 1, and
 * the strength scales past that, for screens, neon and anything meant to bloom. Its default of 1
 * renders as core glTF does. Tone mapping runs on the result like on any other light.
 *
 * An unset slot holds `Texture.WHITE`, so the texture multiply changes nothing.
 * @internal
 */
export const emissiveBit: ShaderBit = {
  name: 'emissive',
  textures: ['emissive'],
  bindings: {
    material: {
      emissive: 'vec3<f32>',
      emissiveStrength: 'f32',
    },
  },
  gpu: {
    fragment: {
      material: /*wgsl*/ `
  emissive = material.emissive * material.emissiveStrength;
  let emissiveTex = sampleEmissive(input.vUV).rgb;
  emissive *= pow(emissiveTex, vec3<f32>(2.2));
`,
    },
  },
  gl: {
    fragment: {
      material: /*glsl*/ `
  emissive = material.emissive * material.emissiveStrength;
  vec3 emissiveTex = sampleEmissive(vUV).rgb;
  emissive *= pow(emissiveTex, vec3(2.2));
`,
    },
  },
};
