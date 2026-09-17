import { describe, expect, it } from 'vitest';

import { compileGlslSource } from '~/core/gl/codegen/compileGlslSource';
import { compileWgslSource } from '~/core/gpu/codegen/compileWgslSource';
import type { ShaderBitTemplate } from '~/core/shader/ShaderBitTemplate';
import { iblBit } from '~/materials/pbr/bits/iblBit';

/**
 * `iblBit` is the substrate split-sum consumer of the env-source contract.
 * It calls `sampleEnvironment(dir, roughness)` declared by whichever
 * env-source bit is in the descriptor (envSourceCubeBit /
 * envSourceHemisphereBit / envSourceDefaultBit).
 *
 * These tests pin the body shape on both backends so the contract stays
 * stable: iblBit must reference `sampleEnvironment` and the Karis
 * split-sum math; env-specific concerns (cubemap sampling, sRGB decode,
 * mip-level math) live in the source bit, not here.
 */

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

describe('iblBit', () => {
  describe('metadata', () => {
    it('declares only the BRDF LUT in bindings.global (env-specific bindings live on source bits)', () => {
      expect(iblBit.bindings?.global).toMatchObject({
        uBrdfLutTexture: 'texture_2d<f32>',
      });
    });

    it('does NOT declare uEnvironmentTexture itself (lives on envSourceCubeBit)', () => {
      // Env-specific bindings are owned by the active env-source bit so the
      // descriptor only carries them when an actual cubemap is in play.
      expect((iblBit.bindings?.global as Record<string, string> | undefined)?.uEnvironmentTexture).toBeUndefined();
    });

    it('does NOT declare uEnvironmentMaxMipLevel (lives on globalBitGl for GL backend)', () => {
      expect((iblBit.bindings?.global as Record<string, string> | undefined)?.uEnvironmentMaxMipLevel).toBeUndefined();
    });

    it('provides both gpu and gl backend bodies', () => {
      expect(iblBit.gpu?.fragment?.lighting).toBeDefined();
      expect(iblBit.gl?.fragment?.lighting).toBeDefined();
    });
  });

  describe('WGSL body', () => {
    const out = compileWgslSource({ bits: [iblBit], template: wgslTemplate });
    const src = out.fragment.source;

    it('delegates env sampling to sampleEnvironment (no direct texture call)', () => {
      expect(src).toContain('sampleEnvironment(R_ibl, roughness)');
      expect(src).not.toContain('textureSampleLevel(uEnvironmentTexture');
      expect(src).not.toContain('textureNumLevels(uEnvironmentTexture)');
    });

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

    it('delegates env sampling to sampleEnvironment (no direct texture call)', () => {
      expect(src).toContain('sampleEnvironment(R_ibl, roughness)');
      expect(src).not.toContain('textureLod(uEnvironmentTexture');
    });

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
