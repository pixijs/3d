import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * The unlit surface: the material's `baseColor` times its base colour texture, written into
 * `albedo` and `alpha`, which the material template outputs with no lighting
 *
 * Unlike the lit material bits it doesn't sRGB-decode the texture, so the texture shows as
 * authored. It only undoes pixi's premultiplied-alpha upload, to keep `albedo` a straight colour.
 *
 * The shader samples unconditionally: an unset slot holds `Texture.WHITE`, which reads as
 * `(1, 1, 1, 1)`, so the multiply changes nothing.
 *
 * It declares `alphaCutoff` without reading it, so the struct, which is fixed at construction,
 * already holds the field when `alphaMode` switches to `'mask'` and `alphaMaskBit` joins.
 *
 * Shared by `FlatMaterial` and `ParticleMaterial`.
 * @internal
 */
export const flatMaterialBit: ShaderBit = {
  name: 'flatMaterial',

  textures: ['baseColor'],

  bindings: {
    material: {
      baseColor: 'vec4<f32>',
      alphaCutoff: 'f32',
    },
  },

  gpu: {
    fragment: {
      material: /*wgsl*/ `
  var baseColor = material.baseColor;

  var baseTex = sampleBaseColor(input.vUV);
  baseTex = vec4<f32>(baseTex.rgb / max(baseTex.a, 0.001), baseTex.a);
  baseColor *= baseTex;

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;
`,
    },
  },

  gl: {
    fragment: {
      material: /*glsl*/ `
  vec4 baseColor = material.baseColor;

  vec4 baseTex = sampleBaseColor(vUV);
  baseTex.rgb /= max(baseTex.a, 0.001);
  baseColor *= baseTex;

  albedo *= baseColor.rgb;
  alpha *= baseColor.a;
`,
    },
  },
};
