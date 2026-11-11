import type { ShaderBit } from '../ShaderBit';

/**
 * `calculateShadow` here must match the shadow bits' signature and the call in `createLightingBit`,
 * on each backend
 * @internal
 */
export const noShadowBit: ShaderBit = {
  name: 'no-shadow',
  gpu: {
    header: /*wgsl*/ `
    fn calculateShadow(
      shadowDataIndex: f32,
      cascadeCount: f32,
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
