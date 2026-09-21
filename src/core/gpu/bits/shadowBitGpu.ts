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
 * The comparison sampler does the depth test per tap; results are averaged. A
 * single centre tap skips the kernel entirely for the cheapest `'hard'` filter.
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
 * Cascaded shadow-map sampling for WebGPU with PCF
 *
 * Selects the appropriate cascade based on the fragment's view-space depth,
 * then samples the corresponding shadow map layer with PCF. The kernel comes
 * from `SHADOW_TAPS` for the requested {@link ShadowFilter}.
 *
 * Falls back to standard single-map behaviour when cascadeCount <= 1.
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
      // Six vec4 per slot in the global uniforms (layout on ShadowDataList).
      let slot = idx * 6;
      let lightSpaceMatrix = mat4x4<f32>(
        global.uShadowData[slot],
        global.uShadowData[slot + 1],
        global.uShadowData[slot + 2],
        global.uShadowData[slot + 3],
      );
      let sp = global.uShadowData[slot + 4];

      // Normal offset, tapered by how obliquely the light strikes the surface.
      // Depth error across one shadow texel grows as the surface turns away from
      // the light, so a face-on surface needs almost none — and taking none is
      // what stops the offset eating short shadows.
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

    // Takes the light's two shadow fields, not the Light struct. Some mobile
    // drivers misread a storage-buffer struct passed into a function by value,
    // so a light with no shadow would miss the early return below.
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

      // Not cascaded: one map, sampled directly.
      if (last < 1) {
        return sampleShadowAtIndex(baseIndex, worldPos, normal, NdotL);
      }

      let viewDepth = -(camera.uViewMatrix * vec4<f32>(worldPos, 1.0)).z;
      let splits = global.uShadowData[baseIndex * 6 + 5].xyz;

      // Splits are sorted ascending, so the cascade is the number of split
      // planes viewDepth is past, clamped to the light's cascade count.
      let crossed = step(splits, vec3<f32>(viewDepth));
      let cascadeIndex = i32(min(dot(crossed, vec3<f32>(1.0)), f32(last)));

      let shadow = sampleShadowAtIndex(baseIndex + cascadeIndex, worldPos, normal, NdotL);

      // The outermost cascade has nothing to fade into.
      if (cascadeIndex == last) {
        return shadow;
      }

      // This cascade's own near/far split, picked without indexing the vector.
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
