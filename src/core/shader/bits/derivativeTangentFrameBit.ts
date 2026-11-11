import type { ShaderBit } from '../ShaderBit';

/**
 * The bitangent points the way `v` shrinks, to match glTF tangents, and the frame's handedness is
 * worked out per fragment, since which way window y runs depends on the backend and the target
 * @internal
 */
export const derivativeTangentFrameBit: ShaderBit = {
  name: 'derivativeTangentFrame',

  gpu: {
    header: /*wgsl*/ `
fn calculateTBN(surfaceNormal: vec3<f32>, position: vec3<f32>, texCoord: vec2<f32>) -> mat3x3<f32> {
  let dp1 = dpdx(position);
  let dp2 = dpdy(position);
  let duv1 = dpdx(texCoord);
  let duv2 = dpdy(texCoord);

  let dp2perp = cross(dp2, surfaceNormal);
  let dp1perp = cross(surfaceNormal, dp1);
  let tangent = dp2perp * duv1.x + dp1perp * duv2.x;
  let bitangent = -(dp2perp * duv1.y + dp1perp * duv2.y);

  let invmax = inverseSqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
  let scale = select(invmax, -invmax, dot(dp1, dp2perp) < 0.0);
  return mat3x3<f32>(tangent * scale, bitangent * scale, surfaceNormal);
}
`,
  },

  gl: {
    fragment: {
      header: /*glsl*/ `
mat3 calculateTBN(highp vec3 surfaceNormal, highp vec3 position, highp vec2 texCoord) {
  highp vec3 dp1 = dFdx(position);
  highp vec3 dp2 = dFdy(position);
  highp vec2 duv1 = dFdx(texCoord);
  highp vec2 duv2 = dFdy(texCoord);

  highp vec3 dp2perp = cross(dp2, surfaceNormal);
  highp vec3 dp1perp = cross(surfaceNormal, dp1);
  highp vec3 tangent = dp2perp * duv1.x + dp1perp * duv2.x;
  highp vec3 bitangent = -(dp2perp * duv1.y + dp1perp * duv2.y);

  highp float invmax = inversesqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
  highp float scale = dot(dp1, dp2perp) < 0.0 ? -invmax : invmax;
  return mat3(tangent * scale, bitangent * scale, surfaceNormal);
}
`,
    },
  },
};
