import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { iblBit } from '~/materials/pbr/bits/iblBit';

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

describe("iblBit reads the environment only through the source bit's sampleEnvironment", () => {
  describe('metadata', () => {
    it('declares no uEnvironmentTexture; the global bits bind it', () => {
      expect((iblBit.bindings?.global as Record<string, string> | undefined)?.uEnvironmentTexture).toBeUndefined();
    });
  });

  describe('WGSL body', () => {
    const out = compileWgslSource({ bits: [iblBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('samples the diffuse approximation along the normal at roughness=1.0 (max mip equivalent)', () => {
      expect(src).toContain('sampleEnvironment(normal, 1.0)');
    });

    it('reconstructs single-scatter FssEss with roughness-aware grazing Fresnel', () => {
      expect(src).toContain('k_S * f_ab.x + f90 * f_ab.y');
      expect(src).toContain('(1.0 - FssEss - FmsEms) * (1.0 - metallic)');
    });

    it('adds Fdez-Agüera multiple-scattering energy back (no INV_PI double-count)', () => {
      expect(src).toContain('F_avg');
      expect(src).toContain('FmsEms');
      expect(src).not.toContain('INV_PI');
    });

    it('composes specular radiance + (multiscatter + diffuse) irradiance into ambient', () => {
      expect(src).toContain('ambient += FssEss * radiance + (FmsEms + k_D) * irradiance');
    });
  });

  describe('GLSL body', () => {
    const out = compileGlslSource({ bits: [iblBit], template: glslTemplate });
    const src = out.fragment;

    it('samples the diffuse approximation along the normal at roughness=1.0', () => {
      expect(src).toContain('sampleEnvironment(normal, 1.0)');
    });

    it('reconstructs single-scatter FssEss with roughness-aware grazing Fresnel', () => {
      expect(src).toContain('k_S * f_ab.x + f90 * f_ab.y');
      expect(src).toContain('(1.0 - FssEss - FmsEms) * (1.0 - metallic)');
    });

    it('adds Fdez-Agüera multiple-scattering energy back (no INV_PI double-count)', () => {
      expect(src).toContain('F_avg');
      expect(src).toContain('FmsEms');
      expect(src).not.toContain('INV_PI');
    });

    it('composes specular radiance + (multiscatter + diffuse) irradiance into ambient', () => {
      expect(src).toContain('ambient += FssEss * radiance + (FmsEms + k_D) * irradiance');
    });
  });
});
