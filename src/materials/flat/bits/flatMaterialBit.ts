import { baseAlphaBit } from '../../../core/shader/bits/baseAlphaBit';
import { baseColorTextureBit } from '../../../core/shader/bits/baseColorTextureBit';
import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Declares `alphaCutoff` without reading it, so the struct, fixed at construction, already holds it
 * when `'mask'` mode adds `alphaMaskBit`
 * @internal
 */
export const flatMaterialBit: ShaderBit = {
  name: 'flatMaterial',

  requires: [baseColorTextureBit, baseAlphaBit],

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
