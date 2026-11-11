import { describe, expect, it } from 'vitest';

import { createStructLayout } from '~/core/shader/codegen/structLayout';

describe('createStructLayout', () => {
  it('should align vec3 to 16 bytes and fit a following f32 into its last 4', () => {
    const layout = createStructLayout({
      normal: 'vec3<f32>',
      factor: 'f32',
    });

    expect(layout.elements).toHaveLength(2);
    expect(layout.elements[0]).toEqual({
      name: 'normal',
      type: 'vec3<f32>',
      offset: 0,
      size: 12,
      components: 3,
    });
    expect(layout.elements[1]).toEqual({
      name: 'factor',
      type: 'f32',
      offset: 12,
      size: 4,
      components: 1,
    });
    expect(layout.size).toBe(16);
  });

  it('should align vec2 to 8 bytes, leaving a 4-byte gap after a leading f32', () => {
    const layout = createStructLayout({
      intensity: 'f32',
      scale: 'vec2<f32>',
    });

    expect(layout.elements[0].offset).toBe(0);
    expect(layout.elements[1].offset).toBe(8);
    expect(layout.size).toBe(16);
  });
});
