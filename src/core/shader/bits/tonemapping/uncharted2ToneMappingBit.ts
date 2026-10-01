import type { ShaderBit } from '../../ShaderBit';

/**
 * John Hable's filmic curve from Uncharted 2, then the display encode `srgbEncodeBit` describes
 *
 * The curve is `(x(Ax + CB) + DE) / (x(Ax + B) + DF) - E/F`, with Hable's constants: shoulder
 * strength A = 0.15, linear strength B = 0.50, linear angle C = 0.10, toe strength D = 0.20, toe
 * numerator E = 0.02 and toe denominator F = 0.30 (Hable 2010, "Filmic Tonemapping Operators").
 * The input is doubled first, and the result is divided by the curve's value at the white point,
 * 11.2, so that input maps to 1. It gives strong contrast.
 * @internal
 */
export const uncharted2ToneMappingBit: ShaderBit = {
  name: 'uncharted2ToneMapping',

  gpu: {
    header: `
fn uncharted2Curve(x: vec3<f32>) -> vec3<f32> {
  let A = 0.15;
  let B = 0.50;
  let C = 0.10;
  let D = 0.20;
  let E = 0.02;
  let F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

fn uncharted2Tonemap(color: vec3<f32>) -> vec3<f32> {
  let exposureBias = 2.0;
  let W = vec3<f32>(11.2);
  let curr = uncharted2Curve(color * exposureBias);
  let whiteScale = vec3<f32>(1.0) / uncharted2Curve(W);
  return curr * whiteScale;
}
`,
    fragment: {
      end: `
  finalColor = uncharted2Tonemap(finalColor);

  finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
`,
    },
  },

  gl: {
    header: `
vec3 uncharted2Curve(vec3 x) {
  float A = 0.15;
  float B = 0.50;
  float C = 0.10;
  float D = 0.20;
  float E = 0.02;
  float F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

vec3 uncharted2Tonemap(vec3 color) {
  float exposureBias = 2.0;
  vec3 W = vec3(11.2);
  vec3 curr = uncharted2Curve(color * exposureBias);
  vec3 whiteScale = vec3(1.0) / uncharted2Curve(W);
  return curr * whiteScale;
}
`,
    fragment: {
      end: `
  finalColor = uncharted2Tonemap(finalColor);

  finalColor = pow(finalColor, vec3(1.0 / 2.2));
`,
    },
  },
};
