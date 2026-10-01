import { describe, expect, it } from 'vitest';

import { phongLightingBit } from '~/materials/phong/bits/phongLightingBit';
import { phongMaterialBit } from '~/materials/phong/bits/phongMaterialBit';

describe('phongMaterialBit', () => {
  it('sRGB-decodes the base texture (a lit material shades in linear light)', () => {
    expect(phongMaterialBit.gpu?.fragment?.material).toContain('pow(baseTexLinear, vec3<f32>(2.2))');
    expect(phongMaterialBit.gl?.fragment?.material).toContain('pow(baseTexLinear, vec3(2.2))');
  });
});

describe('phongLightingBit keeps Blinn-Phong normalized, with Fresnel and the PBR 1 / PI convention', () => {
  const wgsl = phongLightingBit.gpu?.fragment?.lighting ?? '';
  const glsl = phongLightingBit.gl?.fragment?.lighting ?? '';

  it('uses the half-vector (Blinn), not a reflection vector', () => {
    expect(wgsl).toContain('normalize(viewDir + lightDir)');
    expect(glsl).toContain('normalize(viewDir + lightDir)');
    expect(wgsl).not.toContain('reflect(');
    expect(glsl).not.toContain('reflect(');
  });

  it('energy-normalizes the specular lobe by (shininess/2 + 1)/PI', () => {
    expect(wgsl).toContain('(shininess * 0.5 + 1.0) * INV_PI');
    expect(glsl).toContain('(shininess * 0.5 + 1.0) * INV_PI');
  });

  it('applies Fresnel-Schlick to the specular tint in the exp2 spherical-Gaussian form, not pow5', () => {
    expect(wgsl).toContain('exp2((-5.55473 * vDotH - 6.98316) * vDotH)');
    expect(glsl).toContain('exp2((-5.55473 * vDotH - 6.98316) * vDotH)');
    expect(wgsl).not.toContain('pow(1.0 - vDotH, 5.0)');
    expect(glsl).not.toContain('pow(1.0 - vDotH, 5.0)');
  });

  it('PI-normalizes diffuse and ambient (matches the engine PBR convention)', () => {
    expect(wgsl).toContain('albedo * INV_PI');
    expect(wgsl).toContain('uGlobalLightParams.xyz * albedoOverPI');
    expect(glsl).toContain('albedo * INV_PI');
    expect(glsl).toContain('uGlobalLightParams.xyz * albedoOverPI');
  });

  it('adds the view environment irradiance to ambient (iblBit substrate-diffuse convention)', () => {
    expect(wgsl).toContain('sampleEnvironment(normal, 1.0) * albedo');
    expect(glsl).toContain('sampleEnvironment(normal, 1.0) * albedo');
  });

  it('scales specular by specularStrength and adds emissive to finalColor', () => {
    expect(wgsl).toContain('* specularStrength');
    expect(wgsl).toContain('finalColor = ambient + directLight + emissive;');
    expect(glsl).toContain('* specularStrength');
    expect(glsl).toContain('finalColor = ambient + directLight + emissive;');
  });
});
