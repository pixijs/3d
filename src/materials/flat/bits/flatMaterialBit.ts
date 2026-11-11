import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Declares `alphaCutoff` without reading it, so the struct, fixed at construction, already holds it
 * when `'mask'` mode adds `alphaMaskBit`
 * @internal
 */
export const flatMaterialBit: ShaderBit = {
  name: 'flatMaterial',

  textures: ['baseColor'],

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

  let baseTex = sampleBaseColor(input.vUV);
  baseColor *= vec4<f32>(decodeColor(baseTex.rgb / max(baseTex.a, 0.001)), baseTex.a);

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  vec4 baseColor = inputTint(material.baseColor, material.displayBaseColor);

  vec4 baseTex = sampleBaseColor(vUV);
  baseColor *= vec4(decodeColor(baseTex.rgb / max(baseTex.a, 0.001)), baseTex.a);

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;
`,
    },
  },
};
