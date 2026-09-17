import type { ShaderBit } from '../../../core/shader/ShaderBit';

/**
 * Flat (unlit) material: base color × optional texture, output directly
 *
 * Reads base color from the material storage buffer, optionally samples
 * the base color texture, and outputs the result — no lighting, no IBL,
 * no tone mapping.
 *
 * Provides `material` (GPU) and `alphaCutoff` (GL) so `alphaMaskBit`
 * can be used with flat materials when needed.
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

  // No HAS_UVS gate: unbound base-color slots default to Texture.WHITE so
  // sampling at uv=(0,0) returns (1,1,1,1) and the multiply collapses to a
  // no-op. Keeps WGSL source-level parity with the GLSL backend.
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
