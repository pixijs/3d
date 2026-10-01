import { describe, expect, it } from 'vitest';

import { createGlobalUniformGroup } from '~/core/GlobalUniformGroup';

describe('createGlobalUniformGroup', () => {
  const lightData = new Float32Array(4);
  const shadowData = new Float32Array(4);

  it('uses the passed arrays as the light and shadow uniforms', () => {
    const group = createGlobalUniformGroup(lightData, shadowData);

    expect(group.uniforms.uLightData).toBe(lightData);
    expect(group.uniforms.uShadowData).toBe(shadowData);
  });

  it('keeps the two arrays last, after any extra uniforms', () => {
    const group = createGlobalUniformGroup(lightData, shadowData, { uExtra: { value: 0, type: 'f32' } });

    const names = Object.keys(group.uniformStructures);

    expect(names).toContain('uExtra');
    expect(names.slice(-2)).toEqual(['uLightData', 'uShadowData']);
  });

  it('is static and outside a UBO', () => {
    const group = createGlobalUniformGroup(lightData, shadowData);

    expect(group.isStatic).toBe(true);
    expect(group.ubo).toBe(false);
  });
});
