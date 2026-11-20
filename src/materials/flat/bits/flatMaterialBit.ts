import { baseColorTextureBit } from '../../../core/shader/bits/baseColorTextureBit';
import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * The unlit surface: the material's base colour times its base colour texture, written into
 * `albedo`, which the material template outputs with no lighting
 *
 * The texture sample is `baseTex`, which `baseColorTextureBit` took, and `baseAlphaBit` sets
 * `alpha`. This bit undoes pixi's premultiplied-alpha upload, then reads the texture and tint through the
 * colour-space helpers, so `albedo` is a straight colour in the shader's colour space: linear
 * light, decoded with a 2.2 gamma, or as authored when a `colorSpace: 'display'` material skips
 * the decode and its encode. Either way the texture and tint show as authored.
 *
 * It declares `alphaCutoff` without reading it, so the struct, which is fixed at construction,
 * already holds the field when `alphaMode` switches to `'mask'` and `alphaMaskBit` joins.
 *
 * Shared by `FlatMaterial` and `ParticleMaterial`.
 * @internal
 */
export const flatMaterialBit: ShaderBit = {
  name: 'flatMaterial',

  requires: [baseColorTextureBit],

  bindings: {
    material: {
      baseColor: 'vec4<f32>',
      displayBaseColor: 'vec4<f32>',
      alphaCutoff: 'f32',
    },
  },

  gpu: {
    fragment: {
      material: /*wgsl*/ `
  var baseColor = inputTint(material.baseColor, material.displayBaseColor);

  baseColor *= vec4<f32>(decodeColor(baseTex.rgb / max(baseTex.a, 0.001)), baseTex.a);

  albedo *= baseColor.rgb;
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  vec4 baseColor = inputTint(material.baseColor, material.displayBaseColor);

  baseColor *= vec4(decodeColor(baseTex.rgb / max(baseTex.a, 0.001)), baseTex.a);

  albedo *= baseColor.rgb;
`,
    },
  },
};
