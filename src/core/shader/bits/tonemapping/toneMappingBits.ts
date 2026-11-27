import type { ToneMapping } from '../../../../scene/View3D';
import type { ShaderBit } from '../../ShaderBit';
import { acesToneMappingBit } from './acesToneMappingBit';
import { reinhardToneMappingBit } from './reinhardToneMappingBit';
import { srgbEncodeBit } from './srgbEncodeBit';
import { uncharted2ToneMappingBit } from './uncharted2ToneMappingBit';

/**
 * `null` for `'custom'`, which leaves the output linear
 * @internal
 */
export const TONE_MAPPING_BITS: Record<ToneMapping, ShaderBit | null> = {
  aces: acesToneMappingBit,
  reinhard: reinhardToneMappingBit,
  uncharted2: uncharted2ToneMappingBit,
  none: srgbEncodeBit,
  custom: null,
};

/**
 * Light past what alpha covers is added light, as from bloom or an additive material, and gets its own curve rather
 * than being curved as coverage, which clamps it to alpha; alpha 1 counts it all as covered, so opaque pixels keep
 * one curve
 */
const splitLightBit: ShaderBit = {
  name: 'outputSplitLight',
  gpu: {
    fragment: {
      end: /* wgsl */ `
  let outputAddedLight = max(finalColor - vec3<f32>(fxColor.a), vec3<f32>(0.0)) * (1.0 - fxColor.a);
  finalColor = (finalColor - outputAddedLight) / max(fxColor.a, 1e-6);
`,
    },
  },
  gl: {
    fragment: {
      end: /* glsl */ `
  vec3 outputAddedLight = max(finalColor - vec3(fxColor.a), vec3(0.0)) * (1.0 - fxColor.a);
  finalColor = (finalColor - outputAddedLight) / max(fxColor.a, 1e-6);
`,
    },
  },
};

const premultiplyCoveredBit: ShaderBit = {
  name: 'outputPremultiplyCovered',
  gpu: { fragment: { end: 'let outputCovered = finalColor * fxColor.a; finalColor = outputAddedLight;' } },
  gl: { fragment: { end: 'vec3 outputCovered = finalColor * fxColor.a; finalColor = outputAddedLight;' } },
};

/** Picks 0 where no light was added, since a curve can return a tiny negative or NaN for 0 */
const sumLightBit: ShaderBit = {
  name: 'outputSumLight',
  gpu: {
    fragment: {
      end: 'finalColor = outputCovered + select(vec3<f32>(0.0), finalColor, outputAddedLight > vec3<f32>(0.0));',
    },
  },
  gl: {
    fragment: {
      end: 'finalColor = outputCovered + mix(vec3(0.0), finalColor, greaterThan(outputAddedLight, vec3(0.0)));',
    },
  },
};

/** The curve's `end` without its header, which the first copy already declared, for the added light */
const ADDED_LIGHT_CURVE_BITS = new Map(
  Object.values(TONE_MAPPING_BITS)
    .filter((curve) => curve !== null)
    .map((curve): [ShaderBit, ShaderBit] => [
      curve,
      {
        name: `${curve.name}AddedLight`,
        gpu: { fragment: { end: curve.gpu?.fragment?.end } },
        gl: { fragment: { end: curve.gl?.fragment?.end } },
      },
    ]),
);

/** Fixed per pixel so a still image doesn't shimmer, and scaled by alpha so clear pixels stay clear */
const ditherBit: ShaderBit = {
  name: 'outputDither',
  gpu: {
    fragment: {
      end: 'finalColor += (fract(52.9829189 * fract(dot(input.position.xy, vec2<f32>(0.06711056, 0.00583715)))) - 0.5) / 255.0 * fxColor.a;',
    },
  },
  gl: {
    fragment: {
      end: 'finalColor += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0 * fxColor.a;',
    },
  },
};

/**
 * Needs the source colour in `fxColor`, the result in `finalColor` and, in WGSL, `input.position`
 * @internal
 */
export function toneOutputBits(toneMapping: ToneMapping | null | undefined): ShaderBit[] {
  const curve = toneMapping ? TONE_MAPPING_BITS[toneMapping] : null;
  return curve
    ? [splitLightBit, curve, premultiplyCoveredBit, ADDED_LIGHT_CURVE_BITS.get(curve)!, sumLightBit, ditherBit]
    : [];
}
