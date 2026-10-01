import type { ShaderBit } from '../ShaderBit';

/**
 * A `calculateShadow` that always returns 1, fully lit
 *
 * The renderer gives a lit material this in place of the shadow-sampling bit when the mesh doesn't
 * receive shadows or no light has cast any, so the light loop calls `calculateShadow` either way.
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
