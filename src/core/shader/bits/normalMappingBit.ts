import type { ShaderBit } from '../ShaderBit';

/**
 * Per-pixel normal mapping using a normal map texture and a derivative-based TBN
 *
 * Uses screen-space derivatives to calculate tangent/bitangent (no tangent
 * attributes needed).
 *
 * Without this bit: Uses interpolated vertex normals (flat/smooth shading)
 * With this bit: Per-pixel normals from normal map (detailed surface)
 *
 * Requires:
 *   - normal: vec3 - Must be initialized to vertex normal before this runs
 *   - input.vPosition / vPosition - World position
 *   - input.vUV / vUV - Texture coordinates
 *   - uNormalTexture - Normal map texture (in local bindings)
 *
 * Outputs:
 *   - normal: vec3 - Updated with normal map detail
 *
 * ## WGSL window-Y compensation (the `-dpdy(...)` in calculateTBN)
 *
 * WGSL's window-Y points DOWN (framebuffer convention) while GLSL's window-Y
 * points UP (legacy OpenGL). So `dpdy(p) == -dFdy(p)` for the same fragment.
 * Without compensation this negates BOTH tangent and bitangent in the derived
 * TBN (each is built from terms that all flip together with `dp2` / `duv2`),
 * which negates the in-plane perturbation — the bumps invert: convex ridges
 * shade like concave dents and vice versa.
 *
 * We negate `dpdy()` in the WGSL `calculateTBN` so the WGSL TBN matches the
 * GLSL TBN bit-for-bit. Negating only `dpdy()` (not the cross-product result)
 * keeps the math closest in form to the GLSL version, so a future reader can
 * diff the two backends. Pinned by `tests/normalMappingBit.test.ts`.
 *
 * Note: this comment lives at the TS level (not inside the WGSL string) so
 * the explanation doesn't ship to every user's GPU driver as shader source.
 * @internal
 */
export const normalMappingBit: ShaderBit = {
  name: 'normalMapping',

  // No bindings: `normalScale` lives in pbrMaterialBit's material struct —
  // this bit is selected per-mesh, and per-mesh bits must not reshape the
  // per-material struct.
  gpu: {
    header: `
fn calculateTBN(surfaceNormal: vec3<f32>, position: vec3<f32>, texCoord: vec2<f32>) -> mat3x3<f32> {
  let dp1 = dpdx(position);
  let dp2 = -dpdy(position); // WGSL window-Y is flipped vs GLSL; see file header
  let duv1 = dpdx(texCoord);
  let duv2 = -dpdy(texCoord);

  let dp2perp = cross(dp2, surfaceNormal);
  let dp1perp = cross(surfaceNormal, dp1);
  let tangent = dp2perp * duv1.x + dp1perp * duv2.x;
  let bitangent = dp2perp * duv1.y + dp1perp * duv2.y;

  let invmax = inverseSqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
  return mat3x3<f32>(tangent * invmax, bitangent * invmax, surfaceNormal);
}
`,
    fragment: {
      material: `
  // Normal mapping. material.normalScale defaults to 1 (no-op); broadcast
  // across xy and renormalised by the final normalize().
  let normalMapSample = sampleNormal(input.vUV).rgb;
  var tangentNormal = normalMapSample * 2.0 - 1.0;
  tangentNormal = vec3<f32>(tangentNormal.xy * material.normalScale, tangentNormal.z);
  let tbnMatrix = calculateTBN(normal, input.vPosition, input.vUV);
  normal = normalize(tbnMatrix * tangentNormal);
`,
    },
  },

  gl: {
    fragment: {
      header: `
mat3 calculateTBN(highp vec3 surfaceNormal, highp vec3 position, highp vec2 texCoord) {
  highp vec3 dp1 = dFdx(position);
  highp vec3 dp2 = dFdy(position);
  highp vec2 duv1 = dFdx(texCoord);
  highp vec2 duv2 = dFdy(texCoord);

  highp vec3 dp2perp = cross(dp2, surfaceNormal);
  highp vec3 dp1perp = cross(surfaceNormal, dp1);
  highp vec3 tangent = dp2perp * duv1.x + dp1perp * duv2.x;
  highp vec3 bitangent = dp2perp * duv1.y + dp1perp * duv2.y;

  highp float invmax = inversesqrt(max(dot(tangent, tangent), dot(bitangent, bitangent)));
  return mat3(tangent * invmax, bitangent * invmax, surfaceNormal);
}
`,
      material: `
  {
  // Normal mapping — see WGSL counterpart for the normalScale rationale.
  vec3 normalMapSample = sampleNormal(vUV).rgb;
  vec3 tangentNormal = normalMapSample * 2.0 - 1.0;
  tangentNormal.xy *= material.normalScale;
  mat3 tbnMatrix = calculateTBN(normal, vPosition, vUV);
  normal = normalize(tbnMatrix * tangentNormal);
  }
`,
    },
  },
};
