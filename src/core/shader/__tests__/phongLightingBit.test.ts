import { describe, expect, it } from 'vitest';

import { phongLightingBit } from '~/materials/phong/bits/phongLightingBit';
import { phongMaterialBit } from '~/materials/phong/bits/phongMaterialBit';

/**
 * Pins the Blinn-Phong model against "simplify this" refactors — the
 * normalization, Fresnel term, and PI convention are exactly the parts that
 * separate a correct Phong from ODIE's un-normalized reflect model, and they're
 * easy to drop by accident. Raw-string inspection of the bits (no GPU compile),
 * mirroring createLightingBit.test.ts.
 */

describe('phongMaterialBit', () => {
  it('declares the always-present Blinn-Phong struct fields', () => {
    const mat = phongMaterialBit.bindings?.material ?? {};
    expect(mat.baseColor).toBe('vec4<f32>');
    expect(mat.specularColor).toBe('vec3<f32>');
    expect(mat.shininess).toBe('f32');
    expect(mat.specularStrength).toBe('f32');
    expect(mat.alphaCutoff).toBe('f32');
    // normalScale is owned here (per-material) because the normal-mapping bits
    // that read it are selected per-MESH and must not reshape the struct.
    expect(mat.normalScale).toBe('f32');
    // emissive rides the gated emissiveBit — the material samples it itself.
    expect(mat.emissive).toBeUndefined();
    expect(phongMaterialBit.textures).toEqual(['baseColor', 'normal']);
  });

  it('declares a neutral emissive default and reads the specularStrength dial from the struct', () => {
    const wgsl = phongMaterialBit.gpu?.fragment?.material ?? '';
    const glsl = phongMaterialBit.gl?.fragment?.material ?? '';
    expect(wgsl).toContain('var emissive: vec3<f32> = vec3<f32>(0.0);');
    expect(wgsl).toContain('var specularStrength = material.specularStrength;');
    expect(glsl).toContain('vec3 emissive = vec3(0.0);');
    expect(glsl).toContain('float specularStrength = material.specularStrength;');
  });

  it('sRGB-decodes the base texture (a lit material shades in linear light)', () => {
    expect(phongMaterialBit.gpu?.fragment?.material).toContain('pow(baseTexLinear, vec3<f32>(2.2))');
    expect(phongMaterialBit.gl?.fragment?.material).toContain('pow(baseTexLinear, vec3(2.2))');
  });
});

describe('phongLightingBit — normalized Blinn-Phong', () => {
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

  it('applies a Fresnel-Schlick term (spherical-gaussian approx) on the specular tint', () => {
    // The cheaper exp2 form of Schlick's pow5 — the codebase's mobile convention.
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

  it('defines INV_PI in its header for both backends', () => {
    expect(phongLightingBit.gpu?.header).toContain('INV_PI');
    expect(phongLightingBit.gl?.header).toContain('INV_PI');
  });
});
