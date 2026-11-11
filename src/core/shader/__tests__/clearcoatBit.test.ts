import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import { createLightingBit } from '~/core/shader/createLightingBit';
import type { ShaderBit } from '~/core/shader/ShaderBit';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { clearcoatBit, clearcoatNormalMapBit } from '~/materials/pbr/bits/clearcoatBit';

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

function expectSharedLobeContract(src: string, lang: 'wgsl' | 'glsl'): void {
  const loopRe = lang === 'wgsl' ? /for \(var n: i32 = 0;/g : /for \(int n = 0;/g;
  expect((src.match(loopRe) ?? []).length).toBe(1);

  const setup = src.indexOf(
    lang === 'wgsl' ? 'var clearcoatLight = vec3<f32>(0.0);' : 'vec3 clearcoatLight = vec3(0.0);',
  );
  const perLight = src.indexOf('clearcoatLight += ccD * ccF * ccVis');
  const composite = src.indexOf('finalColor = finalColor * ccAttenuation');
  const loopOpen = src.indexOf(lang === 'wgsl' ? 'for (var n: i32 = 0;' : 'for (int n = 0;');
  const loopClose = src.indexOf('}', perLight);
  expect(setup).toBeLessThan(loopOpen);
  expect(perLight).toBeGreaterThan(loopOpen);
  expect(perLight).toBeLessThan(loopClose);
  expect(composite).toBeGreaterThan(loopClose);

  expect(src).toMatch(/finalColor = finalColor \* ccAttenuation \+ \(clearcoatLight \+ clearcoatIBL\) \* ccFactor/);

  expect(src).toContain('reflect(-viewDir, ccNormal)');
  expect(src).toContain('sampleEnvironment(ccR, ccRoughnessIBL)');
  expect(src).toContain(lang === 'wgsl' ? 'let clearcoatIBL =' : 'vec3 clearcoatIBL =');
  expect(src).not.toMatch(/clearcoatIBL\s*\*\s*occlusion/);
  expect(src).not.toContain('HAS_CLEARCOAT_NORMAL');
}

describe('clearcoatBit, whose coat normal is the geometric normal', () => {
  describe('WGSL', () => {
    const src = wgslSource(clearcoatBit);

    it('honours the shared lobe contract and inlines CLEARCOAT_F0', () => {
      expectSharedLobeContract(src, 'wgsl');
      expect(src).toContain('material.clearcoatParams');
      expect(src).toContain('const CLEARCOAT_F0: f32 = 0.04');
      expect(src).not.toContain('override CLEARCOAT_F0');
    });

    it('uses the geometric normal, flipped on back faces, as the coat normal', () => {
      expect(src).toContain('let ccNormal = normalize(select(-input.vNormal, input.vNormal, input.frontFacing))');
    });
  });

  describe('GLSL', () => {
    const src = glSource(clearcoatBit);

    it('honours the shared lobe contract and #defines CLEARCOAT_F0', () => {
      expectSharedLobeContract(src, 'glsl');
      expect(src).toContain('#define CLEARCOAT_F0 0.04');
    });

    it('uses the geometric normal, flipped on back faces, as the coat normal', () => {
      expect(src).toContain('vec3 ccNormal = normalize(gl_FrontFacing ? vNormal : -vNormal)');
    });
  });
});

describe('clearcoatNormalMapBit, which samples a coat normal map', () => {
  describe('WGSL', () => {
    const src = wgslSource(clearcoatNormalMapBit);

    it('honours the shared lobe contract', () => {
      expectSharedLobeContract(src, 'wgsl');
      expect(src).toContain('material.clearcoatParams');
      expect(src).toContain('const CLEARCOAT_F0: f32 = 0.04');
    });

    it('builds the TBN on the geometric normal, flipped on back faces, so each back face reflects its own side', () => {
      expect(src).toContain('calculateTBN(normalize(select(-input.vNormal, input.vNormal, input.frontFacing))');
    });
  });

  describe('GLSL', () => {
    const src = glSource(clearcoatNormalMapBit);

    it('honours the shared lobe contract', () => {
      expectSharedLobeContract(src, 'glsl');
      expect(src).toContain('#define CLEARCOAT_F0 0.04');
    });

    it('builds the TBN on the geometric normal, flipped on back faces, so each back face reflects its own side', () => {
      expect(src).toContain('calculateTBN(normalize(gl_FrontFacing ? vNormal : -vNormal)');
    });
  });
});
