import type { ShaderBit } from '../ShaderBit';

/**
 * Declares the constants `PI` and `INV_PI` for a bit that lists it in `requires`
 *
 * The lighting of {@link Material3D} and {@link PhongMaterial} requires it already, so a bit for
 * either must not declare its own `PI` or `INV_PI`: the second declaration fails the compile.
 * @example
 * ```ts
 * const ringsBit: ShaderBit = {
 *   name: 'rings',
 *   requires: [mathConstantsBit],
 *   gpu: { fragment: { material: 'albedo *= 0.75 + 0.25 * cos(input.vUV.x * 8.0 * PI);' } },
 *   gl: { fragment: { material: 'albedo *= 0.75 + 0.25 * cos(vUV.x * 8.0 * PI);' } },
 * };
 * ```
 * @category rendering
 * @advanced
 */
export const mathConstantsBit: ShaderBit = {
  name: 'mathConstants',

  gpu: {
    header: /*wgsl*/ `
const PI: f32 = 3.14159265359;
const INV_PI: f32 = 0.31830988618;
`,
  },

  gl: {
    header: /*glsl*/ `
const float PI = 3.14159265359;
const float INV_PI = 0.31830988618;
`,
  },
};
