import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { createLightingBit } from '~/core/shader/createLightingBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { sheenBit } from '~/materials/pbr/bits/sheenBit';

/**
 * `sheenBit` is the second concrete consumer of the lobe-composition
 * convention introduced by `createLightingBit` (clearcoat was the first).
 * These tests pin:
 *
 *   1. Metadata: struct binding, single packed texture slot.
 *   2. When composed with a host lighting bit it splices into the *single*
 *      light loop at the right phases — no second `for (i in lights)`.
 *   3. The shader output references `material.sheenParams` and the Charlie /
 *      Ashikhmin / sheenE helpers declared by the bit's header.
 *   4. Single-slot packing: `sampleSheen` (not `sampleSheenColor` /
 *      `sampleSheenRoughness`) — sheen intentionally packs color + roughness
 *      into one texture to save a batch slot.
 */

// Minimal host that mirrors `pbrLightingBit`'s contract for sibling lobes:
// declares `nDotV` pre-loop and `halfVector` + `nDotH` inside the loop so
// `sheenBit` can reuse them instead of recomputing (see sheenBit.ts).
const hostLighting = createLightingBit({
  name: 'hostLighting',
  preLighting: {
    gpu: 'var directLight = vec3<f32>(0.0);\nlet nDotV = max(dot(normal, viewDir), 0.0);',
    gl: 'vec3 directLight = vec3(0.0);\nfloat nDotV = max(dot(normal, viewDir), 0.0);',
  },
  perLight: {
    gpu: `
      let halfVector = normalize(viewDir + lightDir);
      let nDotH = max(dot(normal, halfVector), 0.0);
      directLight += light.color * nDotL * attenuation * shadow;
    `,
    gl: `
      vec3 halfVector = normalize(viewDir + lightDir);
      float nDotH = max(dot(normal, halfVector), 0.0);
      directLight += light.color * nDotL * attenuation * shadow;
    `,
  },
  postLighting: {
    gpu: 'finalColor = directLight;',
    gl: 'finalColor = directLight;',
  },
});

const wgslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gpu: '{{header}}\n{{fragmentLighting}}',
};

// Find the closing `}` of the `{` at `openBraceIdx` by tracking brace depth.
// Using `src.indexOf('}', ...)` naively matches inner `{ ... }` scopes in a
// lobe's perLight snippet rather than the outer loop's close, which silently
// hid "composite accidentally inside the loop" regressions.
function findMatchingClose(src: string, openBraceIdx: number): number {
  let depth = 0;
  for (let i = openBraceIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unmatched '{' at index ${openBraceIdx}`);
}

const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\nvoid main() { {{lighting}} }',
  },
};

describe('sheenBit', () => {
  describe('metadata', () => {
    it('declares a single packed sheen texture slot', () => {
      // Single slot (RGB color + A roughness) — see sheenBit.ts rationale.
      expect(sheenBit.textures).toEqual(['sheen']);
    });

    it('binds sheenParams as a vec4 in the material struct', () => {
      expect(sheenBit.bindings?.material).toEqual({ sheenParams: 'vec4<f32>' });
    });

    it('does not declare any shader overrides', () => {
      // Sheen has no conditional features (no normal map override, etc.),
      // so no need for any override plumbing.
      expect(sheenBit.overrideDefs).toBeUndefined();
    });
  });

  describe('WGSL composition with a host lighting bit', () => {
    const out = compileWgslSource({
      bits: [hostLighting, sheenBit],
      template: wgslTemplate,
    });
    const src = out.fragment.source;

    it('produces exactly one light loop (single shadow-sample path)', () => {
      const matches = src.match(/for \(var i: i32 = 0;/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('places sheen setup before the loop, Charlie*Ashikhmin inside, composite after', () => {
      const setupIdx = src.indexOf('var sheenLight = vec3<f32>(0.0);');
      const perLightIdx = src.indexOf('sheenLight += sheenColor');
      const compositeIdx = src.indexOf('finalColor = finalColor * sheenAlbedoScale');
      const loopOpenIdx = src.indexOf('for (var i: i32 = 0;');
      // Match the for-loop's opening `{` and walk braces forward — a plain
      // `indexOf('}', perLightIdx)` would stop at the close of sheen's inner
      // per-light `{ ... }` scope, letting a "composite moved inside the loop"
      // regression slip past the test.
      const loopOpenBraceIdx = src.indexOf('{', loopOpenIdx);
      const loopCloseIdx = findMatchingClose(src, loopOpenBraceIdx);

      expect(setupIdx).toBeLessThan(loopOpenIdx);
      expect(perLightIdx).toBeGreaterThan(loopOpenIdx);
      expect(perLightIdx).toBeLessThan(loopCloseIdx);
      expect(compositeIdx).toBeGreaterThan(loopCloseIdx);
    });

    it('declares the Charlie NDF / Ashikhmin V / sheenE helpers in the header', () => {
      expect(src).toContain('fn charlieD(');
      expect(src).toContain('fn ashikhminV(');
      expect(src).toContain('fn sheenE(');
    });

    it('reuses halfVector + nDotH from the host lighting bit (no duplicate recomputation)', () => {
      // sheen shares the surface normal with the base PBR lobe, so the
      // half-vector and nDotH computed by pbrLightingBit.perLight are
      // directly usable. Duplicating them would be ~1 normalize + 1 dot
      // wasted per light per fragment. Pin this to prevent regressions.
      const normalizes = src.match(/normalize\s*\(\s*viewDir\s*\+\s*lightDir\s*\)/g) ?? [];
      expect(normalizes.length).toBe(1);
      // sheen's per-light body should NOT declare an `shH` / `shNdotH` of its own.
      expect(src).not.toMatch(/let\s+shH\s*=/);
      expect(src).not.toMatch(/let\s+shNdotH\s*=/);
    });

    it('hoists the Charlie light-independent factor out of the per-light call', () => {
      // charlieScale = (2 + 1/α) · (2π)⁻¹ and invAlphaHalf = 1/(2α) don't
      // depend on the light, so they're computed once in lobePreLighting
      // before the loop. The charlieD function signature takes them as args.
      expect(src).toContain('let sheenInvAlpha');
      expect(src).toContain('let sheenCharlieScale');
      expect(src).toContain('charlieD(sheenCharlieScale, sheenInvAlphaHalf, nDotH)');
      // charlieD body should NOT compute 1/α itself anymore.
      expect(src).not.toMatch(/fn charlieD[^)]*\)\s*->\s*f32\s*\{[^}]*1\.0\s*\/\s*sheenAlpha/);
    });

    it('hoists sheenMax (RGB max) out of the per-light / post-lighting inline math', () => {
      // The base-lobe attenuation uses max(sheenColor.r, max(.g, .b)) which
      // is light-independent — hoisted to lobePreLighting and referenced by
      // name in the composite.
      expect(src).toContain('let sheenMax');
      expect(src).toMatch(/sheenAlbedoScale\s*=\s*1\.0\s*-\s*sheenMax\s*\*\s*shE/);
    });

    it('references sheenParams and samples the single packed sheen texture', () => {
      expect(src).toContain('material.sheenParams');
      // Single-slot convention: one sampler, sampled as .rgb for color + .a
      // for roughness. No per-aspect samplers should exist.
      expect(src).toContain('sampleSheen(input.vUV)');
      expect(src).not.toContain('sampleSheenColor');
      expect(src).not.toContain('sampleSheenRoughness');
    });

    it('undoes premultiplied-alpha upload and applies sRGB decode on sheen RGB', () => {
      // Sheen packs roughness in .a (data, not coverage) but Pixi uploads
      // with premultiplied-alpha by default, so RGB arrives scaled by
      // roughness. We must divide RGB by A before the gamma-2.2 sRGB decode —
      // same treatment pbrMaterialBit applies to baseColor / emissive.
      // Pinning this prevents regressions that would visibly dim sheen
      // color in packed-texture assets.
      expect(src).toMatch(/sheenTex\.rgb\s*\/\s*max\s*\(\s*sheenTex\.a/);
      expect(src).toMatch(/pow\(sheenTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });

    it('uses two-tier roughness (unclamped for IBL / sheenE, min-clamped for Charlie direct)', () => {
      // Same pattern clearcoatBit established: IBL mip selection + the
      // directional-albedo sheenE() LUT must see the raw [0, 1] roughness
      // so the env-map LOD tracks the authored value; only the Charlie
      // direct math needs a min clamp to keep pow(sin2h, 1/(2α)) stable
      // at very low α.
      expect(src).toContain('let sheenRoughnessIBL');
      expect(src).toContain('sampleEnvironment(shR, sheenRoughnessIBL)');
      expect(src).toContain('sheenE(nDotV, sheenRoughnessIBL)');
      // The Charlie direct path still uses the clamped value.
      expect(src).toMatch(/let sheenRoughness\s*=\s*max\s*\(\s*sheenRoughnessIBL/);
    });

    it('composites via base-attenuation + sheen direct + sheen IBL (energy-conservation formula)', () => {
      // The composite formula is the core of the sheen spec: attenuate the
      // substrate by the sheen directional albedo (sheenAlbedoScale), then
      // add direct and image-based sheen. Pinning it prevents accidental
      // drift back to a naive additive blend.
      expect(src).toMatch(/finalColor = finalColor \* sheenAlbedoScale \+ sheenLight \+ sheenIBL/);
    });

    it('does NOT scale sheenIBL by occlusion (fibers scatter regardless of substrate AO)', () => {
      expect(src).not.toMatch(/sheenIBL\s*\*\s*occlusion/);
    });

    it('samples the env via sampleEnvironment with the sheen roughness', () => {
      // Env sampling is delegated to the active env-source bit
      // (envSourceCubeBit / envSourceHemisphereBit / envSourceDefaultBit) —
      // sheen works under all three.
      expect(src).toContain('reflect(-viewDir, normal)');
      expect(src).toContain('sampleEnvironment(shR, sheenRoughnessIBL)');
    });

    it('does not emit any normal-map override identifier', () => {
      // glTF 2.0 sheen spec has no normal map, so no HAS_SHEEN_NORMAL branch
      // should exist — sheen uses the surface normal directly.
      expect(src).not.toContain('HAS_SHEEN_NORMAL');
    });
  });

  describe('GLSL composition with a host lighting bit', () => {
    const out = compileGlslSource({
      bits: [hostLighting, sheenBit],
      template: glslTemplate,
    });
    const src = out.fragment;

    it('produces exactly one light loop (single shadow-sample path)', () => {
      const matches = src.match(/while \(lightMask != 0u\)/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('places sheen setup before the loop, Charlie*Ashikhmin inside, composite after', () => {
      const setupIdx = src.indexOf('vec3 sheenLight = vec3(0.0);');
      const perLightIdx = src.indexOf('sheenLight += sheenColor');
      const compositeIdx = src.indexOf('finalColor = finalColor * sheenAlbedoScale');
      const loopOpenIdx = src.indexOf('while (lightMask != 0u)');
      // See WGSL counterpart: brace-match to find the real loop close.
      const loopOpenBraceIdx = src.indexOf('{', loopOpenIdx);
      const loopCloseIdx = findMatchingClose(src, loopOpenBraceIdx);

      expect(setupIdx).toBeLessThan(loopOpenIdx);
      expect(perLightIdx).toBeGreaterThan(loopOpenIdx);
      expect(perLightIdx).toBeLessThan(loopCloseIdx);
      expect(compositeIdx).toBeGreaterThan(loopCloseIdx);
    });

    it('guards the helper definitions with an ifndef so re-inclusion is safe', () => {
      expect(src).toContain('#ifndef PIXI3D_SHEEN_HELPERS_DEFINED');
      expect(src).toContain('float charlieD(');
      expect(src).toContain('float ashikhminV(');
      expect(src).toContain('float sheenE(');
    });

    it('reuses halfVector + nDotH from the host lighting bit', () => {
      const normalizes = src.match(/normalize\s*\(\s*viewDir\s*\+\s*lightDir\s*\)/g) ?? [];
      expect(normalizes.length).toBe(1);
      expect(src).not.toMatch(/vec3\s+shH\s*=/);
      expect(src).not.toMatch(/float\s+shNdotH\s*=/);
    });

    it('hoists Charlie constants and sheenMax out of the per-light path', () => {
      expect(src).toContain('float sheenInvAlpha');
      expect(src).toContain('float sheenCharlieScale');
      expect(src).toContain('charlieD(sheenCharlieScale, sheenInvAlphaHalf, nDotH)');
      expect(src).toContain('float sheenMax');
      expect(src).toMatch(/sheenAlbedoScale\s*=\s*1\.0\s*-\s*sheenMax\s*\*\s*shE/);
    });

    it('samples the env via sampleEnvironment with the sheen roughness', () => {
      // Env sampling is delegated to the active env-source bit. The mip-level
      // plumbing (uEnvironmentMaxMipLevel for WebGL) lives inside
      // envSourceCubeBit's sampleEnvironment implementation.
      expect(src).toContain('reflect(-viewDir, normal)');
      expect(src).toContain('sampleEnvironment(shR, sheenRoughnessIBL)');
    });

    it('samples the single packed sheen texture', () => {
      expect(src).toContain('sampleSheen(vUV)');
      expect(src).not.toContain('sampleSheenColor');
      expect(src).not.toContain('sampleSheenRoughness');
    });

    it('undoes premultiplied-alpha upload and applies sRGB decode on sheen RGB', () => {
      expect(src).toMatch(/sheenTex\.rgb\s*\/\s*max\s*\(\s*sheenTex\.a/);
      expect(src).toMatch(/pow\(sheenTexStraight,\s*vec3(?:<f32>)?\(2\.2\)\)/);
    });

    it('uses two-tier roughness (unclamped for IBL / sheenE, min-clamped for Charlie direct)', () => {
      expect(src).toContain('float sheenRoughnessIBL');
      expect(src).toContain('sampleEnvironment(shR, sheenRoughnessIBL)');
      expect(src).toContain('sheenE(nDotV, sheenRoughnessIBL)');
      expect(src).toMatch(/float sheenRoughness\s*=\s*max\s*\(\s*sheenRoughnessIBL/);
    });

    it('does NOT scale sheenIBL by occlusion', () => {
      expect(src).not.toMatch(/sheenIBL\s*\*\s*occlusion/);
    });
  });
});
