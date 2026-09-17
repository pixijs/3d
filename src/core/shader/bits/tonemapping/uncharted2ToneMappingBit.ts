import type { ShaderBit } from '../../ShaderBit';

/**
 * Uncharted 2 filmic tone mapping with gamma correction
 *
 * John Hable's filmic curve from Uncharted 2. Produces a cinematic look with
 * strong contrast — suited to dramatic lighting.
 * @internal
 */
export const uncharted2ToneMappingBit: ShaderBit = {
  name: 'uncharted2ToneMapping',

  gpu: {
    header: `
// Uncharted 2 filmic curve (John Hable)
fn uncharted2Curve(x: vec3<f32>) -> vec3<f32> {
  let A = 0.15;  // Shoulder strength
  let B = 0.50;  // Linear strength
  let C = 0.10;  // Linear angle
  let D = 0.20;  // Toe strength
  let E = 0.02;  // Toe numerator
  let F = 0.30;  // Toe denominator
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

fn uncharted2Tonemap(color: vec3<f32>) -> vec3<f32> {
  let exposureBias = 2.0;
  let W = vec3<f32>(11.2);  // Linear white point
  let curr = uncharted2Curve(color * exposureBias);
  let whiteScale = vec3<f32>(1.0) / uncharted2Curve(W);
  return curr * whiteScale;
}
`,
    fragment: {
      end: `
  // Uncharted 2 filmic tone mapping
  finalColor = uncharted2Tonemap(finalColor);

  // Gamma correction (linear → sRGB)
  finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));
`,
    },
  },

  gl: {
    header: `
// Uncharted 2 filmic curve (John Hable)
vec3 uncharted2Curve(vec3 x) {
  float A = 0.15;  // Shoulder strength
  float B = 0.50;  // Linear strength
  float C = 0.10;  // Linear angle
  float D = 0.20;  // Toe strength
  float E = 0.02;  // Toe numerator
  float F = 0.30;  // Toe denominator
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

vec3 uncharted2Tonemap(vec3 color) {
  float exposureBias = 2.0;
  vec3 W = vec3(11.2);  // Linear white point
  vec3 curr = uncharted2Curve(color * exposureBias);
  vec3 whiteScale = vec3(1.0) / uncharted2Curve(W);
  return curr * whiteScale;
}
`,
    fragment: {
      end: `
  // Uncharted 2 filmic tone mapping
  finalColor = uncharted2Tonemap(finalColor);

  // Gamma correction (linear → sRGB)
  finalColor = pow(finalColor, vec3(1.0 / 2.2));
`,
    },
  },
};
