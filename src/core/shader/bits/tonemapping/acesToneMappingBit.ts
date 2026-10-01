import type { ShaderBit } from '../../ShaderBit';

/**
 * ACES filmic tone mapping, then the display encode `srgbEncodeBit` describes
 *
 * It uses Stephen Hill's fit of the ACES reference and output transforms. `inMat` takes linear
 * sRGB into the ACES AP1 primaries with the reference transform's saturation tweak folded in, each
 * channel goes through the fitted curve, and `outMat` brings the result back to linear sRGB. The
 * matrices give ACES its desaturation and contrast; Narkowicz's cheaper fit is one curve per
 * channel and leaves them out.
 *
 * The input is first scaled by 1/0.6. Narkowicz pre-exposes his fit the same way, so that an input
 * of 1 comes out near 0.8 and the image stays about as bright as with no curve; "for the original
 * ACES curve just multiply input (x) by 0.6" (Narkowicz 2016, "ACES Filmic Tone Mapping Curve").
 * Here an input of 1 comes out at 0.76, where the unscaled fit gives 0.62. The view's exposure
 * multiplies in before this bit runs.
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
