import { describe, expect, it } from 'vitest';

import { createLightingBit } from '~/core/shader/createLightingBit';

describe('createLightingBit', () => {
  const bit = createLightingBit({
    name: 'testLighting',
    preLighting: {
      gpu: 'var accum = vec3<f32>(0.0);',
      gl: 'vec3 accum = vec3(0.0);',
    },
    perLight: {
      gpu: 'accum += light.color * nDotL * attenuation * shadow;',
      gl: 'accum += light.color * nDotL * attenuation * shadow;',
    },
    postLighting: {
      gpu: 'finalColor = accum;',
      gl: 'finalColor = accum;',
    },
  });

  it('preserves the supplied name', () => {
    expect(bit.name).toBe('testLighting');
  });

  describe('WGSL output', () => {
    const wgsl = bit.gpu?.fragment?.lighting ?? '';

    it('emits the light loop with dispatch, attenuation, shadow, and nDotL', () => {
      expect(wgsl).toContain('for (var i: i32 = 0;');
      expect(wgsl).toContain('let light = uLightStorage[i];');
      expect(wgsl).toContain('if (light.kind == LIGHT_DIRECTIONAL)');
      expect(wgsl).toContain('if (light.kind == LIGHT_SPOT)');
      expect(wgsl).toContain('if (attenuation <= 0.0)');
      expect(wgsl).toContain('let nDotL = max(dot(normal, lightDir), 0.0);');
      expect(wgsl).toContain('let shadow = calculateShadow(');
    });

    it('splices user code at preLighting, perLight, and postLighting', () => {
      const pre = wgsl.indexOf('var accum = vec3<f32>(0.0);');
      const loop = wgsl.indexOf('accum += light.color * nDotL * attenuation * shadow;');
      const post = wgsl.indexOf('finalColor = accum;');
      expect(pre).toBeGreaterThan(-1);
      expect(loop).toBeGreaterThan(pre);
      expect(post).toBeGreaterThan(loop);
    });
  });

  describe('GLSL output', () => {
    const glsl = bit.gl?.fragment?.lighting ?? '';
    const glslHeader = bit.gl?.header ?? '';

    it('emits the light loop with dispatch, attenuation, shadow, and nDotL', () => {
      expect(glsl).toContain('for (int i = 0;');
      expect(glsl).toContain('Light light = getLight(i);');
      expect(glsl).toContain('if (light.type == LIGHT_DIRECTIONAL)');
      expect(glsl).toContain('if (light.type == LIGHT_SPOT)');
      expect(glsl).toContain('if (attenuation <= 0.0) continue;');
      expect(glsl).toContain('float nDotL = max(dot(normal, lightDir), 0.0);');
      expect(glsl).toContain('float shadow = calculateShadow(');
    });

    it('declares getLight() in the fragment header with an ifndef guard', () => {
      expect(glslHeader).toContain('Light getLight(int index)');
      expect(glslHeader).toContain('#ifndef PIXI3D_GET_LIGHT_DEFINED');
    });

    it('splices user code at preLighting, perLight, and postLighting', () => {
      const pre = glsl.indexOf('vec3 accum = vec3(0.0);');
      const loop = glsl.indexOf('accum += light.color * nDotL * attenuation * shadow;');
      const post = glsl.indexOf('finalColor = accum;');
      expect(pre).toBeGreaterThan(-1);
      expect(loop).toBeGreaterThan(pre);
      expect(post).toBeGreaterThan(loop);
    });
  });

  it('omits optional slots cleanly when only perLight is supplied', () => {
    const minimal = createLightingBit({
      name: 'minimal',
      perLight: { gpu: 'accum += 1.0;', gl: 'accum += 1.0;' },
    });
    expect(minimal.gpu?.fragment?.lighting).toContain('accum += 1.0;');
    expect(minimal.gl?.fragment?.lighting).toContain('accum += 1.0;');
  });

  describe('light-kind constants', () => {
    // The LIGHT_DIRECTIONAL / LIGHT_POINT / LIGHT_SPOT constants live on the
    // global bit (see src/gpu/shader/globalBitGpu.ts + src/gl/shader/globalBitGl.ts)
    // so they're declared once per shader rather than duplicated by each
    // lighting bit. Here we just confirm the factory *uses* them by name in
    // its generated loop bodies.
    it('uses LIGHT_DIRECTIONAL / LIGHT_SPOT in the factory-generated loop bodies', () => {
      const wgsl = bit.gpu?.fragment?.lighting ?? '';
      const glsl = bit.gl?.fragment?.lighting ?? '';
      expect(wgsl).toContain('light.kind == LIGHT_DIRECTIONAL');
      expect(wgsl).toContain('light.kind == LIGHT_SPOT');
      expect(glsl).toContain('light.type == LIGHT_DIRECTIONAL');
      expect(glsl).toContain('light.type == LIGHT_SPOT');
    });
  });
});
