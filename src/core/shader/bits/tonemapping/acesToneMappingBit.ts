import type { ShaderBit } from '../../ShaderBit';

/**
 * Stephen Hill's ACES fit, with the input scaled by 1/0.6 as Narkowicz pre-exposes his, so an input
 * of 1 lands near 0.76; then the display encode, which must match `srgbEncodeBit`
 * @internal
 */
export const acesToneMappingBit: ShaderBit = {
  name: 'acesToneMapping',

  gpu: {
    header: `
fn acesTonemap(linearColor: vec3<f32>) -> vec3<f32> {
  let inMat = mat3x3<f32>(
    vec3<f32>(0.59719, 0.07600, 0.02840),
    vec3<f32>(0.35458, 0.90834, 0.13383),
    vec3<f32>(0.04823, 0.01566, 0.83777),
  );
  let outMat = mat3x3<f32>(
    vec3<f32>(1.60475, -0.10208, -0.00327),
    vec3<f32>(-0.53108, 1.10813, -0.07276),
    vec3<f32>(-0.07367, -0.00605, 1.07602),
  );

  var color = inMat * (linearColor * (1.0 / 0.6));

  let a = color * (color + vec3<f32>(0.0245786)) - vec3<f32>(0.000090537);
  let b = color * (0.983729 * color + vec3<f32>(0.4329510)) + vec3<f32>(0.238081);
  color = a / b;

  return clamp(outMat * color, vec3<f32>(0.0), vec3<f32>(1.0));
}
`,
    fragment: {
      end: `
  finalColor = acesTonemap(finalColor);
  finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
`,
    },
  },

  gl: {
    header: `
vec3 acesTonemap(vec3 linearColor) {
  const mat3 inMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 outMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602)
  );

  vec3 color = inMat * (linearColor * (1.0 / 0.6));

  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = a / b;

  return clamp(outMat * color, 0.0, 1.0);
}
`,
    fragment: {
      end: `
  finalColor = acesTonemap(finalColor);
  finalColor = pow(finalColor, vec3(1.0 / 2.2));
`,
    },
  },
};
