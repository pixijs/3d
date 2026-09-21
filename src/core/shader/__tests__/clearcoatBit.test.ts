import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { createLightingBit } from '~/core/shader/createLightingBit';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { clearcoatBit, clearcoatNormalMapBit } from '~/materials/pbr/bits/clearcoatBit';

/**
 * `clearcoatBit` is the first concrete consumer of the lobe-composition
 * convention introduced by `createLightingBit`. It ships two construction-
 * selected variants:
 *
 *   - `clearcoatBit`          — no coat normal map: the coat frame is the
 *     geometric normal, so there is no TBN and no coat-normal sample.
 *   - `clearcoatNormalMapBit` — samples the coat normal map + builds a TBN.
 *
 * These tests check that both:
 *   1. Declare their data correctly (struct binding, batch textures).
 *   2. Splice into the *single* light loop at the right phases (no second
 *      `for (i in lights)`).
 *   3. Reference `material.clearcoatParams` + the inlined `CLEARCOAT_F0`.
 *   4. Front-facing-correct the coat normal so double-sided back faces reflect
 *      the correct hemisphere (the bug this split also fixed).
 */

const hostLighting = createLightingBit({
  name: 'hostLighting',
  preLighting: {
    gpu: 'var directLight = vec3<f32>(0.0);',
    gl: 'vec3 directLight = vec3(0.0);',
  },
  perLight: {
    gpu: 'directLight += light.color * nDotL * attenuation * shadow;',
    gl: 'directLight += light.color * nDotL * attenuation * shadow;',
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

const glslTemplate: ShaderBitTemplate = {
  bindGroups: [],
  gl: {
    vertex: '{{header}}\nvoid main() {}',
    fragment: '{{header}}\nvoid main() { {{lighting}} }',
  },
};

const wgslSource = (bit: ShaderBit): string =>
  compileWgslSource({ bits: [hostLighting, bit], template: wgslTemplate }).fragment.source;

const glSource = (bit: ShaderBit): string =>
  compileGlslSource({ bits: [hostLighting, bit], template: glslTemplate }).fragment;

/** Assertions that must hold for both variants (the shared lobe contract). */
function expectSharedLobeContract(src: string, lang: 'wgsl' | 'glsl'): void {
  const loopRe = lang === 'wgsl' ? /for \(var i: i32 = 0;/g : /while \(lightMask != 0u\)/g;
  expect((src.match(loopRe) ?? []).length).toBe(1);

  // setup before loop, GGX inside, composite after.
  const setup = src.indexOf(
    lang === 'wgsl' ? 'var clearcoatLight = vec3<f32>(0.0);' : 'vec3 clearcoatLight = vec3(0.0);',
  );
  const perLight = src.indexOf('clearcoatLight += ccD * ccF * ccVis');
  const composite = src.indexOf('finalColor = finalColor * ccAttenuation');
  const loopOpen = src.indexOf(lang === 'wgsl' ? 'for (var i: i32 = 0;' : 'while (lightMask != 0u)');
  const loopClose = src.indexOf('}', perLight);
  expect(setup).toBeLessThan(loopOpen);
  expect(perLight).toBeGreaterThan(loopOpen);
  expect(perLight).toBeLessThan(loopClose);
  expect(composite).toBeGreaterThan(loopClose);

  // Compositing formula: attenuate base lobe by clearcoat Fresnel, then add the
  // lacquer's direct + image-based specular. Easy to break — pin it.
  expect(src).toMatch(/finalColor = finalColor \* ccAttenuation \+ \(clearcoatLight \+ clearcoatIBL\) \* ccFactor/);

  // Env via the pluggable source; unclamped IBL roughness (perfect mirrors hit
  // mip 0); no AO on the lacquer (it sits on top of substrate occlusion).
  expect(src).toContain('reflect(-viewDir, ccNormal)');
  expect(src).toContain('sampleEnvironment(ccR, ccRoughnessIBL)');
  expect(src).toContain(lang === 'wgsl' ? 'let clearcoatIBL =' : 'vec3 clearcoatIBL =');
  expect(src).not.toMatch(/clearcoatIBL\s*\*\s*occlusion/);
  expect(src).not.toContain('HAS_CLEARCOAT_NORMAL');
}

describe('clearcoatBit (no coat normal map)', () => {
  it('declares only the clearcoat + roughness slots (no coat-normal slot)', () => {
    expect(clearcoatBit.name).toBe('clearcoat');
    expect(clearcoatBit.textures).toEqual(['clearcoat', 'clearcoatRoughness']);
    expect(clearcoatBit.bindings?.material).toEqual({ clearcoatParams: 'vec4<f32>' });
    expect(clearcoatBit.overrideDefs).toBeUndefined();
  });

  describe('WGSL', () => {
    const src = wgslSource(clearcoatBit);

    it('honours the shared lobe contract and inlines CLEARCOAT_F0', () => {
      expectSharedLobeContract(src, 'wgsl');
      expect(src).toContain('material.clearcoatParams');
      expect(src).toContain('const CLEARCOAT_F0: f32 = 0.04');
      expect(src).not.toContain('override CLEARCOAT_F0');
    });

    it('uses the front-facing-corrected geometric normal as the coat frame', () => {
      expect(src).toContain('let ccNormal = normalize(select(-input.vNormal, input.vNormal, input.frontFacing))');
    });

    it('does NOT build a TBN or sample a coat normal map', () => {
      expect(src).not.toContain('calculateClearcoatTBN(');
      expect(src).not.toContain('sampleClearcoatNormal');
    });
  });

  describe('GLSL', () => {
    const src = glSource(clearcoatBit);

    it('honours the shared lobe contract and #defines CLEARCOAT_F0', () => {
      expectSharedLobeContract(src, 'glsl');
      expect(src).toContain('#define CLEARCOAT_F0 0.04');
    });

    it('uses the front-facing-corrected geometric normal as the coat frame', () => {
      expect(src).toContain('vec3 ccNormal = normalize(gl_FrontFacing ? vNormal : -vNormal)');
    });

    it('does NOT build a TBN or sample a coat normal map', () => {
      expect(src).not.toContain('calculateClearcoatTBN(');
      expect(src).not.toContain('sampleClearcoatNormal');
    });
  });
});

describe('clearcoatNormalMapBit (coat normal map)', () => {
  it('declares all three slots and a distinct name (so the shader cache keys apart)', () => {
    expect(clearcoatNormalMapBit.name).toBe('clearcoat:normalMap');
    expect(clearcoatNormalMapBit.textures).toEqual(['clearcoat', 'clearcoatRoughness', 'clearcoatNormal']);
    expect(clearcoatNormalMapBit.bindings?.material).toEqual({ clearcoatParams: 'vec4<f32>' });
  });

  describe('WGSL', () => {
    const src = wgslSource(clearcoatNormalMapBit);

    it('honours the shared lobe contract', () => {
      expectSharedLobeContract(src, 'wgsl');
      expect(src).toContain('material.clearcoatParams');
      expect(src).toContain('const CLEARCOAT_F0: f32 = 0.04');
    });

    it('samples the coat normal and builds its own TBN (distinct from calculateTBN)', () => {
      expect(src).toContain('sampleClearcoatNormal(input.vUV)');
      expect(src).toContain('fn calculateClearcoatTBN(');
      expect(src).not.toContain('fn calculateTBN(');
    });

    it('feeds the TBN the front-facing-corrected surface normal (back-face correct)', () => {
      expect(src).toContain(
        'calculateClearcoatTBN(normalize(select(-input.vNormal, input.vNormal, input.frontFacing))',
      );
    });
  });

  describe('GLSL', () => {
    const src = glSource(clearcoatNormalMapBit);

    it('honours the shared lobe contract', () => {
      expectSharedLobeContract(src, 'glsl');
      expect(src).toContain('#define CLEARCOAT_F0 0.04');
    });

    it('samples the coat normal and guards its TBN helper with an ifndef', () => {
      expect(src).toContain('sampleClearcoatNormal(vUV)');
      expect(src).toContain('#ifndef PIXI3D_CLEARCOAT_TBN_DEFINED');
      expect(src).toContain('mat3 calculateClearcoatTBN(');
    });

    it('feeds the TBN the front-facing-corrected surface normal (back-face correct)', () => {
      expect(src).toContain('calculateClearcoatTBN(normalize(gl_FrontFacing ? vNormal : -vNormal)');
    });
  });
});
