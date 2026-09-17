import type { ShaderBit } from '../ShaderBit';

/**
 * Stub `calculateShadow` that always returns full light
 *
 * Composed in place of a shadow-sampling bit when shadows are disabled, so
 * lighting bits can call `calculateShadow` unconditionally.
 * @internal
 */
export const noShadowBit: ShaderBit = {
  name: 'no-shadow',
  gpu: {
    header: /*wgsl*/ `
    fn calculateShadow(
      light: Light,
      worldPos: vec3<f32>, 
      normal: vec3<f32>,
      NdotL: f32
    ) -> f32 {
      return 1.0;
    }
    `,
  },
  gl: {
    header: `
    float calculateShadow(
      Light light,
      vec3 worldPos,
      vec3 normal,
      float NdotL
    ) {
      return 1.0;
    }
    `,
  },
};
