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

  it('scales specular by specularStrength and adds emissive to finalColor', () => {
    expect(wgsl).toContain('* specularStrength');
    expect(wgsl).toContain('finalColor = ambient + directLight + emissive;');
    expect(glsl).toContain('* specularStrength');
    expect(glsl).toContain('finalColor = ambient + directLight + emissive;');
  });
});
