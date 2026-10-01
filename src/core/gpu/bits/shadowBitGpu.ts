import { CASCADE_BLEND_FRACTION } from '../../render-passes/shadow/csmUtils';
import { MAX_SHADOW_SLOTS } from '../../render-passes/shadow/shadowPassUtils';
import type { ShadowFilter } from '../../render-passes/shadow/shadowPassUtils';
import { SHADOW_TAPS } from '../../shader/bits/shadowTaps';
import type { ShadowTap } from '../../shader/bits/shadowTaps';
import type { ShaderBit } from '../../shader/ShaderBit';

/**
 * Format a tap-offset component as a WGSL float literal
 * @param n - Tap-offset component, in texels
 */
function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

/**
 * Emit the PCF accumulation body for a tap set (offsets in texel units)
 *
 * The comparison sampler does the depth test per tap, and the results are averaged. The `'hard'`
 * filter's single centre tap needs no texel size and no average.
 * @param taps - The filter's tap offsets, in texels
 */
function pcfBody(taps: readonly ShadowTap[]): string {
  const spread = taps.some(([x, y]) => x !== 0 || y !== 0);
  const lines: string[] = [];

  if (spread) lines.push('      let texel = 1.0 / sp.z;');

  taps.forEach(([x, y], i) => {
    const coord = x === 0 && y === 0 ? 'uv' : `uv + vec2<f32>(${fmt(x)}, ${fmt(y)}) * texel`;
    lines.push(
      `      ${i === 0 ? 'var s = ' : 's += '}textureSampleCompareLevel(uShadowMap, uShadowSampler, ${coord}, idx, d);`,
    );
  });

  lines.push(taps.length === 1 ? '      return s;' : `      return s / ${fmt(taps.length)};`);

  return lines.join('\n');
}

/**
 * Build the WebGPU shadow bit for one filter. Its `calculateShadow` returns how much of one
 * light reaches a fragment: 0 in full shadow, 1 in full light.
 *
 * A light's slots sit in `uShadowData`, six `vec4` each, as `ShadowDataList` lays them out. A light
 * with no shadow has a `shadowDataIndex` of -1 and returns 1 straight away. A light with fewer than
 * two cascades samples its one map. A cascaded light picks its cascade by counting the split
 * planes the fragment's view depth has passed, which works because the splits are sorted and an
 * unused one is a large sentinel. Over the last `CASCADE_BLEND_FRACTION` of each cascade's depth
 * range, except the outermost one's, the result fades into the next cascade's. That cascade's
 * near and far splits are picked with a one-hot dot product instead of indexing the vector.
 *
 * `sampleShadowAtIndex` moves the position along the normal by the slot's normal bias, scaled by
 * `1 - NdotL`. The depth error across one shadow texel grows as the surface turns away from the
 * light, so a surface facing the light needs almost no offset, and leaving it out there keeps the
 * offset from eating short shadows. A position outside the map is lit. `pcfBody` builds the
 * filter's kernel from `SHADOW_TAPS`.
 *
 * `calculateShadow` takes the light's `shadowDataIndex` and `cascadeCount` as two floats rather
 * than the `Light` struct. On an Adreno 8xx phone in Chrome, a struct passed into a function by
 * value arrived with wrong fields: a light with no shadow missed the early return, sampled an empty
 * slot whose map size is 0, and the PCF offsets turned that into NaN, which drew as black.
 *
 * `shadowBitsGl` is the WebGL twin.
 * @param filter - The shadow filter whose PCF kernel the bit samples
 */
function createShadowBitGpu(filter: ShadowFilter): ShaderBit {
  return {
    name: `shadow:${filter}`,
    bindings: {
      global: {
        uShadowMap: 'texture_depth_2d_array',
        uShadowSampler: 'sampler_comparison',
        uShadowData: `array<vec4<f32>, ${MAX_SHADOW_SLOTS * 6}>`,
      },
    },
    gpu: {
      header: /*wgsl*/ `
    fn sampleShadowAtIndex(
      idx: i32,
      worldPos: vec3<f32>,
      normal: vec3<f32>,
      NdotL: f32,
    ) -> f32 {
      let slot = idx * 6;
      let lightSpaceMatrix = mat4x4<f32>(
        global.uShadowData[slot],
        global.uShadowData[slot + 1],
        global.uShadowData[slot + 2],
        global.uShadowData[slot + 3],
      );
      let sp = global.uShadowData[slot + 4];

      let biasedPos = worldPos + normal * (sp.y * (1.0 - NdotL));
      let lsp = lightSpaceMatrix * vec4<f32>(biasedPos, 1.0);
      let proj = lsp.xyz / lsp.w;

      let uv = proj.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);

      if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || proj.z < 0.0 || proj.z > 1.0) {
        return 1.0;
      }

      let d = proj.z - sp.x;

${pcfBody(SHADOW_TAPS[filter])}
    }

    fn calculateShadow(
      shadowDataIndex: f32,
      cascadeCount: f32,
      worldPos: vec3<f32>,
      normal: vec3<f32>,
      NdotL: f32
    ) -> f32 {
      let baseIndex = i32(shadowDataIndex);

      if (baseIndex == -1) {
        return 1.0;
      }

      let last = i32(cascadeCount) - 1;

      if (last < 1) {
        return sampleShadowAtIndex(baseIndex, worldPos, normal, NdotL);
      }

      let viewDepth = -(camera.uViewMatrix * vec4<f32>(worldPos, 1.0)).z;
      let splits = global.uShadowData[baseIndex * 6 + 5].xyz;

      let crossed = step(splits, vec3<f32>(viewDepth));
      let cascadeIndex = i32(min(dot(crossed, vec3<f32>(1.0)), f32(last)));

      let shadow = sampleShadowAtIndex(baseIndex + cascadeIndex, worldPos, normal, NdotL);

      if (cascadeIndex == last) {
        return shadow;
      }

      let hot = vec3<f32>(f32(cascadeIndex == 0), f32(cascadeIndex == 1), f32(cascadeIndex == 2));
      let splitFar = dot(splits, hot);
      let splitNear = dot(splits, vec3<f32>(hot.y, hot.z, 0.0));

      let band = max((splitFar - splitNear) * ${fmt(CASCADE_BLEND_FRACTION)}, 1e-4);
      let blend = saturate((viewDepth - splitFar + band) / band);

      if (blend <= 0.0) {
        return shadow;
      }

      let next = sampleShadowAtIndex(baseIndex + cascadeIndex + 1, worldPos, normal, NdotL);

      return mix(shadow, next, blend);
    }
  `,
    },
  };
}

/**
 * WebGPU shadow sampler bits keyed by filter tier; selected per-View in `MaterialSystemGpu`
 * @internal
 */
export const shadowBitsGpu: Record<ShadowFilter, ShaderBit> = {
  hard: createShadowBitGpu('hard'),
  pcf: createShadowBitGpu('pcf'),
  'pcf-high': createShadowBitGpu('pcf-high'),
};
