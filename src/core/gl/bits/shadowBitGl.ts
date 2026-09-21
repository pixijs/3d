import { CASCADE_BLEND_FRACTION } from '../../render-passes/shadow/csmUtils';
import { MAX_SHADOW_SLOTS } from '../../render-passes/shadow/shadowPassUtils';
import type { ShadowFilter } from '../../render-passes/shadow/shadowPassUtils';
import { ShadowDataStructGl } from '../../shader/bits/shaderStructs';
import { SHADOW_TAPS } from '../../shader/bits/shadowTaps';
import type { ShadowTap } from '../../shader/bits/shadowTaps';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Format a tap-offset component as a GLSL float literal
 * @param n - Tap-offset component, in texels
 */
function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

/**
 * Emit the PCF sampling body for a tap set (offsets in texel units)
 *
 * The comparison sampler (`sampler2DArrayShadow`) does the depth test per tap;
 * results are averaged. A single centre tap skips the kernel for `'hard'`.
 * @param taps - The filter's tap offsets, in texels
 */
function pcfBody(taps: readonly ShadowTap[]): string {
  const spread = taps.some(([x, y]) => x !== 0 || y !== 0);
  const tap = ([x, y]: ShadowTap): string =>
    x === 0 && y === 0 ? 'uv' : `uv + vec2(${fmt(x)}, ${fmt(y)}) * texelSize`;

  const lines: string[] = ['      float currentDepth = depth - params.x;'];
  if (spread) lines.push('      float texelSize = 1.0 / params.z;');
  lines.push('      float fl = float(layer);', '');

  if (taps.length === 1) {
    lines.push(`      return texture(uShadowMap, vec4(${tap(taps[0])}, fl, currentDepth));`);
  } else {
    const terms = taps.map((t) => `        texture(uShadowMap, vec4(${tap(t)}, fl, currentDepth))`).join(' +\n');
    lines.push(`      float shadow =\n${terms};`, '', `      return shadow / ${fmt(taps.length)};`);
  }

  return lines.join('\n');
}

/**
 * Shadow mapping for WebGL using PCF (Percentage Closer Filtering)
 *
 * Expects a shadow map texture array and a packed uniform array of shadow data
 * (light space matrices, biases, etc.). The PCF kernel comes from
 * `SHADOW_TAPS` for the requested {@link ShadowFilter}.
 *
 * Layout (stride = 6 vec4s = 24 floats per cascade entry, packed by `ShadowDataList`; WebGPU
 * reads the same array):
 * - [0..3]  lightSpaceMatrix (mat4 as 4 vec4s)
 * - [4]     shadowParams (bias, normalBias, mapSize, cascadeCount)
 * - [5]     cascadeSplits (view-space split depths, cascade 0 only)
 *
 * One entry per (light, cascade) slot; a light's cascade `c` lives at
 * `light.shadowDataIndex + c` and samples the matching texture-array layer.
 * @param filter - The shadow filter whose PCF kernel the bit samples
 */
function createShadowBitGl(filter: ShadowFilter): ShaderBit {
  return {
    name: `shadowGl:${filter}`,
    structs: {
      ShadowData: ShadowDataStructGl,
    },
    bindings: {
      global: {
        uShadowMap: 'texture_depth_2d_array',
        uShadowData: `array<vec4<f32>, ${MAX_SHADOW_SLOTS * 6}>`,
      },
    },
    gl: {
      header: /*glsl*/ `

    ShadowData getShadowData(int index) {
      int offset = index * 6;
      ShadowData sd;
      sd.lightSpaceMatrix = mat4(
        uShadowData[offset + 0],
        uShadowData[offset + 1],
        uShadowData[offset + 2],
        uShadowData[offset + 3]
      );
      sd.shadowParams = uShadowData[offset + 4];   // bias, normalBias, mapSize, cascadeCount
      sd.cascadeSplits = uShadowData[offset + 5];  // view-space split depths (cascade 0)
      return sd;
    }

    // Samples one shadow-map array layer with PCF.
    // params = (bias, normalBias, mapSize).
    float sampleShadowLayer(int layer, mat4 lightSpaceMatrix, vec3 worldPos, vec3 normal, vec3 params, float NdotL) {
      // Normal offset, tapered by how obliquely the light strikes the surface.
      // Depth error across one shadow texel grows as the surface turns away from
      // the light, so a face-on surface needs almost none -- and taking none is
      // what stops the offset eating short shadows.
      vec3 biasedPos = worldPos + normal * (params.y * (1.0 - NdotL));
      vec4 lightSpacePos = lightSpaceMatrix * vec4(biasedPos, 1.0);
      vec3 projPos = lightSpacePos.xyz / lightSpacePos.w;

      vec2 uv = projPos.xy * 0.5 + 0.5;
      float depth = projPos.z * 0.5 + 0.5;

      vec3 uvd = vec3(uv, depth);
      if (any(notEqual(clamp(uvd, 0.0, 1.0), uvd))) {
        return 1.0;
      }

${pcfBody(SHADOW_TAPS[filter])}
    }

    float calculateShadow(
      Light light,
      vec3 worldPos,
      vec3 normal,
      float NdotL
    ) {
      int baseIndex = int(light.shadowDataIndex);

      // -1 means this light does not cast shadows
      if (baseIndex == -1) {
        return 1.0;
      }

      // cascadeCount + splits live on the light's first cascade entry.
      ShadowData base = getShadowData(baseIndex);
      int last = int(base.shadowParams.w) - 1;

      // Not cascaded: one map, sampled directly.
      if (last < 1) {
        return sampleShadowLayer(baseIndex, base.lightSpaceMatrix, worldPos, normal, base.shadowParams.xyz, NdotL);
      }

      float viewDepth = -(uViewMatrix * vec4(worldPos, 1.0)).z;
      vec3 splits = base.cascadeSplits.xyz;

      // Splits are sorted ascending, so the cascade is the number of split
      // planes viewDepth is past, clamped to the light's cascade count.
      vec3 crossed = step(splits, vec3(viewDepth));
      int cascadeIndex = int(min(dot(crossed, vec3(1.0)), float(last)));

      int idx = baseIndex + cascadeIndex;
      ShadowData sd = getShadowData(idx);
      float shadow = sampleShadowLayer(idx, sd.lightSpaceMatrix, worldPos, normal, sd.shadowParams.xyz, NdotL);

      // The outermost cascade has nothing to fade into.
      if (cascadeIndex == last) {
        return shadow;
      }

      // This cascade's own near/far split, picked without indexing the vector.
      vec3 hot = vec3(float(cascadeIndex == 0), float(cascadeIndex == 1), float(cascadeIndex == 2));
      float splitFar = dot(splits, hot);
      float splitNear = dot(splits, vec3(hot.y, hot.z, 0.0));

      float band = max((splitFar - splitNear) * ${fmt(CASCADE_BLEND_FRACTION)}, 1e-4);
      float blend = clamp((viewDepth - splitFar + band) / band, 0.0, 1.0);

      if (blend <= 0.0) {
        return shadow;
      }

      ShadowData nd = getShadowData(idx + 1);
      float next = sampleShadowLayer(idx + 1, nd.lightSpaceMatrix, worldPos, normal, nd.shadowParams.xyz, NdotL);

      return mix(shadow, next, blend);
    }
  `,
    },
  };
}

/**
 * WebGL shadow sampler bits keyed by filter tier; selected per-View in `MaterialSystemGl`
 * @internal
 */
export const shadowBitsGl: Record<ShadowFilter, ShaderBit> = {
  hard: createShadowBitGl('hard'),
  pcf: createShadowBitGl('pcf'),
  'pcf-high': createShadowBitGl('pcf-high'),
};
