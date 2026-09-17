import type { ShaderBit } from '../../ShaderBit';

/**
 * ACES filmic tone mapping with gamma correction
 *
 * Industry-standard tone mapping used in film and AAA games. Produces
 * rich, saturated colours with a film-style highlight rolloff.
 *
 * Uses Stephen Hill's fit of the full ACES Reference Rendering Transform +
 * Output Device Transform: the input is rotated into the ACEScg primaries
 * (`ACESInputMat`), run through the `RRTAndODTFit` rational curve per channel,
 * then rotated back to linear sRGB (`ACESOutputMat`). The colour-space matrices
 * are what give ACES its characteristic per-hue desaturation and contrast — a
 * per-channel curve alone (e.g. the cheaper Narkowicz approximation) skips them
 * and renders noticeably brighter and more washed-out / pastel.
 *
 * ## Exposure pre-multiply (`× 1/0.6`)
 *
 * The linear input is multiplied by `1/0.6 ≈ 1.667` before the curve is
 * applied. This is the published "ACES sweet spot" exposure — it shifts
 * the linear scene values into the shoulder of the S-curve, which is the
 * region that gives ACES its signature behaviour:
 *
 *   - bright values curl toward white but **retain their hue**
 *   - mid-tones gain contrast and saturation
 *   - shadows compress with a soft toe instead of clamping to black
 *
 * Per-view exposure is applied upstream (`finalColor *= uExposure`) before
 * this bit runs, so this constant composes with it.
 *
 * ## Gamma encode (`pow(x, 1/2.2)`)
 *
 * The output of the tonemap lives in linear light; the swap-chain
 * expects sRGB. We use the cheap `1/2.2` approximation rather than the
 * piecewise sRGB transfer for shader-cost reasons. The two diverge by
 * ≤ 1.5 % in shadow tones; switch to the full sRGB EOTF if banding
 * becomes visible in dark regions.
 * @internal
 */
export const acesToneMappingBit: ShaderBit = {
  name: 'acesToneMapping',

  gpu: {
    header: `
fn acesTonemap(linearColor: vec3<f32>) -> vec3<f32> {
  // sRGB/linear -> ACEScg primaries (columns).
  let inMat = mat3x3<f32>(
    vec3<f32>(0.59719, 0.07600, 0.02840),
    vec3<f32>(0.35458, 0.90834, 0.13383),
    vec3<f32>(0.04823, 0.01566, 0.83777),
  );
  // ACEScg -> linear sRGB (columns).
  let outMat = mat3x3<f32>(
    vec3<f32>(1.60475, -0.10208, -0.00327),
    vec3<f32>(-0.53108, 1.10813, -0.07276),
    vec3<f32>(-0.07367, -0.00605, 1.07602),
  );

  // Pre-multiply: shift input into the curve's saturation-preserving shoulder.
  var color = inMat * (linearColor * (1.0 / 0.6));

  // RRT + ODT fit (Stephen Hill).
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
  // sRGB/linear -> ACEScg primaries (columns).
  const mat3 inMat = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  // ACEScg -> linear sRGB (columns).
  const mat3 outMat = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602)
  );

  // Pre-multiply: shift input into the curve's saturation-preserving shoulder.
  vec3 color = inMat * (linearColor * (1.0 / 0.6));

  // RRT + ODT fit (Stephen Hill).
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
