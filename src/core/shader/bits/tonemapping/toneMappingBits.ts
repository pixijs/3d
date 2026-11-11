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

/** Leaves an alpha near 0 alone: additive light has no coverage and is already straight */
const straightColorBit: ShaderBit = {
  name: 'outputStraightColor',
  gpu: { fragment: { end: 'finalColor = select(finalColor, finalColor / fxColor.a, fxColor.a > 0.0001);' } },
  gl: { fragment: { end: 'finalColor = fxColor.a > 0.0001 ? finalColor / fxColor.a : finalColor;' } },
};

const premultiplyColorBit: ShaderBit = {
  name: 'outputPremultiplyColor',
  gpu: { fragment: { end: 'finalColor = select(finalColor, finalColor * fxColor.a, fxColor.a > 0.0001);' } },
  gl: { fragment: { end: 'finalColor = fxColor.a > 0.0001 ? finalColor * fxColor.a : finalColor;' } },
};

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
  return curve ? [straightColorBit, curve, premultiplyColorBit, ditherBit] : [];
}
