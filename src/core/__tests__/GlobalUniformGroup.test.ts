import { describe, expect, it } from 'vitest';

import { createGlobalUniformGroup } from '~/core/GlobalUniformGroup';

describe('createGlobalUniformGroup', () => {
  const lightData = new Float32Array(4);
  const shadowData = new Float32Array(4);

  it('is static and a uniform block', () => {
    const group = createGlobalUniformGroup(lightData, shadowData);

    expect(group.isStatic).toBe(true);
    expect(group.ubo).toBe(true);
  });
});
