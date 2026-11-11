import type { ShaderBit } from '../../ShaderBit';

/**
 * John Hable's Uncharted 2 curve (Hable 2010, "Filmic Tonemapping Operators"), then the display
 * encode, which must match `srgbEncodeBit`
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
